package registry

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/astra-security/astra/services/core/internal/model"
	"github.com/astra-security/astra/services/core/internal/resolver"
)

type Client struct {
	HTTP           *http.Client
	NPMURL, OSVURL string
}

// Workers bounds registry fan-out. The default transport keeps only 2 idle
// connections per host, so every worker beyond that pays a fresh TLS handshake
// per request; the pool below is sized to the worker count.
func Workers() int {
	if n, err := strconv.Atoi(os.Getenv("ASTRA_REGISTRY_WORKERS")); err == nil && n >= 1 && n <= 64 {
		return n
	}
	return 16
}

func New() *Client {
	workers := Workers()
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.MaxIdleConns = workers * 4
	transport.MaxIdleConnsPerHost = workers
	transport.MaxConnsPerHost = workers
	transport.IdleConnTimeout = 90 * time.Second
	transport.ForceAttemptHTTP2 = true
	return &Client{HTTP: &http.Client{Timeout: 15 * time.Second, Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, NPMURL: "https://registry.npmjs.org", OSVURL: "https://api.osv.dev/v1/query"}
}

func (c *Client) request(ctx context.Context, method, address string, payload any, out any) ([]byte, error) {
	var body []byte
	if payload != nil {
		var err error
		body, err = json.Marshal(payload)
		if err != nil {
			return nil, err
		}
	}
	for attempt := 0; attempt < 3; attempt++ {
		req, err := http.NewRequestWithContext(ctx, method, address, bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Accept", "application/json")
		req.Header.Set("User-Agent", "Astra/0.1")
		if payload != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		resp, err := c.HTTP.Do(req)
		if err != nil {
			return nil, err
		}
		data, readErr := io.ReadAll(io.LimitReader(resp.Body, 4*1024*1024+1))
		resp.Body.Close()
		if readErr != nil {
			return nil, readErr
		}
		if len(data) > 4*1024*1024 {
			return nil, fmt.Errorf("upstream response exceeds size limit")
		}
		if (resp.StatusCode == 429 || resp.StatusCode >= 500) && attempt < 2 {
			select {
			case <-time.After(time.Duration(attempt+1) * 200 * time.Millisecond):
			case <-ctx.Done():
				return nil, ctx.Err()
			}
			continue
		}
		if resp.StatusCode != 200 {
			return nil, fmt.Errorf("upstream HTTP %d", resp.StatusCode)
		}
		if err := json.Unmarshal(data, out); err != nil {
			return nil, fmt.Errorf("invalid upstream JSON")
		}
		return data, nil
	}
	return nil, fmt.Errorf("upstream retry budget exhausted")
}

var capabilityRules = []struct {
	name string
	re   *regexp.Regexp
}{
	{"network", regexp.MustCompile(`(?i)\b(curl|wget|https?|fetch)\b`)},
	{"environment", regexp.MustCompile(`(?i)process\.env|\$\{?[A-Z_][A-Z0-9_]*`)},
	{"shell", regexp.MustCompile(`(?i)\b(bash|sh|powershell|exec|spawn|child_process)\b`)},
	{"filesystem", regexp.MustCompile(`(?i)\b(writeFile|readFile|unlink|chmod|rm|fs)\b`)},
}

// AnalyzeScripts records capabilities and hashes, never command text or secret values.
func AnalyzeScripts(p *model.Package, scripts map[string]string, source string) []model.Evidence {
	evidence := []model.Evidence{}
	for _, name := range []string{"preinstall", "install", "postinstall"} {
		command, ok := scripts[name]
		if !ok {
			continue
		}
		p.Metadata.HasInstallScript = true
		caps := []string{}
		for _, rule := range capabilityRules {
			if rule.re.MatchString(command) {
				caps = append(caps, rule.name)
			}
		}
		id := "ev:script:" + resolver.Hash([]byte(p.ID + ":" + name))[:20]
		evidence = append(evidence, model.Evidence{ID: id, Kind: "lifecycle_script", Source: source, Location: "scripts." + name, SHA256: resolver.Hash([]byte(command)), Summary: "Lifecycle script " + name + "; lexical capabilities: " + strings.Join(caps, ", ") + ". Referenced files have not been inspected.", Confidence: 0.75})
		p.InstallScripts = append(p.InstallScripts, model.Script{Name: name, Capabilities: caps, EvidenceID: id})
	}
	return evidence
}

func (c *Client) VersionDependencies(ctx context.Context, name, version string) (map[string]string, error) {
	var metadata struct {
		Name         string            `json:"name"`
		Version      string            `json:"version"`
		Dependencies map[string]string `json:"dependencies"`
	}
	address := c.NPMURL + "/" + url.PathEscape(name) + "/" + url.PathEscape(version)
	if _, err := c.request(ctx, http.MethodGet, address, nil, &metadata); err != nil {
		return nil, err
	}
	if metadata.Name != name || metadata.Version != version {
		return nil, fmt.Errorf("registry identity mismatch")
	}
	if metadata.Dependencies == nil {
		return map[string]string{}, nil
	}
	return metadata.Dependencies, nil
}

// packument fetches https://registry.npmjs.org/<name> once; nil means unavailable.
// ponytail: the shared 4MB response cap drops very large packuments (history then reads unknown); raise the cap or use a streaming decoder if that bites.
func (c *Client) packument(ctx context.Context, name string) *packument {
	var pk packument
	raw, err := c.request(ctx, http.MethodGet, c.NPMURL+"/"+url.PathEscape(name), nil, &pk)
	if err != nil {
		return nil
	}
	pk.raw = raw
	return &pk
}

func (c *Client) enrich(ctx context.Context, p model.Package, pk *packument) (model.Package, []model.Evidence, []string) {
	evidence, warnings := []model.Evidence{}, []string{}
	var metadata struct {
		Name        string            `json:"name"`
		Version     string            `json:"version"`
		License     json.RawMessage   `json:"license"`
		Scripts     map[string]string `json:"scripts"`
		Maintainers []struct {
			Name string `json:"name"`
		} `json:"maintainers"`
	}
	address := c.NPMURL + "/" + url.PathEscape(p.Name) + "/" + url.PathEscape(p.Version)
	var raw []byte
	var err error
	// The packument already carries every version, so the exact-version request is
	// only made when this version is missing from it. That halves registry traffic.
	if version, ok := packumentVersion(pk, p.Version); ok {
		address = c.NPMURL + "/" + url.PathEscape(p.Name)
		raw = pk.raw
		metadata.Name, metadata.Version = p.Name, p.Version
		metadata.License = version.License
		metadata.Scripts = version.Scripts
		metadata.Maintainers = version.Maintainers
	} else {
		raw, err = c.request(ctx, http.MethodGet, address, nil, &metadata)
	}
	if err != nil || metadata.Name != p.Name || metadata.Version != p.Version {
		p.Metadata.RegistryStatus = "unavailable"
		warnings = append(warnings, "Registry metadata unavailable for "+p.PURL)
	} else {
		p.Metadata.RegistryStatus = "available"
		_ = json.Unmarshal(metadata.License, &p.License)
		for _, m := range metadata.Maintainers {
			p.Metadata.Maintainers = append(p.Metadata.Maintainers, m.Name)
		}
		sort.Strings(p.Metadata.Maintainers)
		id := "ev:registry:" + resolver.Hash([]byte(p.ID))[:20]
		summary := "Exact-version npm metadata; current maintainers are not ownership history."
		if address != c.NPMURL+"/"+url.PathEscape(p.Name)+"/"+url.PathEscape(p.Version) {
			summary = "Installed-version entry read from the npm packument; current maintainers are not ownership history."
		}
		evidence = append(evidence, model.Evidence{ID: id, Kind: "registry_metadata", Source: address, SHA256: resolver.Hash(raw), Summary: summary, Confidence: 0.9})
		p.EvidenceIDs = append(p.EvidenceIDs, id)
		evidence = append(evidence, AnalyzeScripts(&p, metadata.Scripts, address)...)
	}
	warnings = append(warnings, applyHistory(&p, pk, time.Now().UTC())...)
	if pk != nil {
		id := "ev:registry-history:" + resolver.Hash([]byte(p.ID))[:20]
		evidence = append(evidence, model.Evidence{ID: id, Kind: "registry_history", Source: c.NPMURL + "/" + url.PathEscape(p.Name), SHA256: resolver.Hash(pk.raw), Summary: "npm packument: dist-tags, publish times and per-version maintainers used for upgrade distance, version jump and maintainer change.", Confidence: 0.9})
		p.EvidenceIDs = append(p.EvidenceIDs, id)
	}
	p.Metadata.OSVStatus = "available"
	token := ""
	seen := map[string]bool{}
	for page := 0; page < 20; page++ {
		var result struct {
			Vulns []struct {
				ID               string `json:"id"`
				Summary          string `json:"summary"`
				Withdrawn        string `json:"withdrawn"`
				DatabaseSpecific struct {
					Severity string `json:"severity"`
				} `json:"database_specific"`
				Affected []struct {
					Package struct {
						Name      string `json:"name"`
						Ecosystem string `json:"ecosystem"`
					} `json:"package"`
					Ranges []struct {
						Type   string `json:"type"`
						Events []struct {
							Fixed string `json:"fixed"`
						} `json:"events"`
					} `json:"ranges"`
				} `json:"affected"`
			} `json:"vulns"`
			NextPageToken string `json:"next_page_token"`
		}
		payload := map[string]any{"package": map[string]string{"name": p.Name, "ecosystem": "npm"}, "version": p.Version}
		if token != "" {
			payload["page_token"] = token
		}
		raw, err := c.request(ctx, http.MethodPost, c.OSVURL, payload, &result)
		if err != nil {
			p.Metadata.OSVStatus = "unavailable"
			warnings = append(warnings, "OSV matching incomplete for "+p.PURL)
			break
		}
		queryID := "ev:osv-query:" + resolver.Hash([]byte(p.ID + ":" + token))[:20]
		evidence = append(evidence, model.Evidence{ID: queryID, Kind: "osv_query", Source: c.OSVURL, SHA256: resolver.Hash(raw), Summary: "OSV query for exact installed package/version", Confidence: 0.95})
		p.EvidenceIDs = append(p.EvidenceIDs, queryID)
		for _, v := range result.Vulns {
			if v.Withdrawn != "" || seen[v.ID] {
				continue
			}
			seen[v.ID] = true
			fixes := []string{}
			fixSet := map[string]bool{}
			for _, a := range v.Affected {
				if a.Package.Name != p.Name || a.Package.Ecosystem != "npm" {
					continue
				}
				for _, r := range a.Ranges {
					if r.Type != "SEMVER" && r.Type != "ECOSYSTEM" {
						continue
					}
					for _, e := range r.Events {
						if e.Fixed != "" && !fixSet[e.Fixed] {
							fixSet[e.Fixed] = true
							fixes = append(fixes, e.Fixed)
						}
					}
				}
			}
			sort.Strings(fixes)
			severity := strings.ToLower(v.DatabaseSpecific.Severity)
			switch severity {
			case "critical", "high", "medium", "low":
			default:
				severity = "unknown"
			}
			id := "ev:osv:" + resolver.Hash([]byte(p.ID + ":" + v.ID))[:20]
			summary := v.Summary
			if summary == "" {
				summary = v.ID
			}
			evidence = append(evidence, model.Evidence{ID: id, Kind: "vulnerability", Source: "https://osv.dev/vulnerability/" + url.PathEscape(v.ID), SHA256: resolver.Hash(raw), Summary: summary, Confidence: 0.95})
			p.Vulnerabilities = append(p.Vulnerabilities, model.Vulnerability{ID: v.ID, Summary: summary, Severity: severity, FixedVersions: fixes, EvidenceID: id})
		}
		if result.NextPageToken == "" {
			break
		}
		if result.NextPageToken == token || page == 19 {
			p.Metadata.OSVStatus = "unavailable"
			warnings = append(warnings, "OSV pagination limit reached for "+p.PURL)
			break
		}
		token = result.NextPageToken
	}
	sort.Slice(p.Vulnerabilities, func(i, j int) bool { return p.Vulnerabilities[i].ID < p.Vulnerabilities[j].ID })
	return p, evidence, warnings
}

func (c *Client) Enrich(ctx context.Context, g *model.Graph) {
	type result struct {
		p model.Package
		e []model.Evidence
		w []string
	}
	results := make([]result, len(g.Packages))
	packuments := map[string]*packument{}
	for _, p := range g.Packages {
		packuments[p.Name] = nil
	}
	names := make([]string, 0, len(packuments))
	for name := range packuments {
		names = append(names, name)
	}
	var mu sync.Mutex
	parallel(len(names), func(i int) {
		pk := c.packument(ctx, names[i])
		mu.Lock()
		packuments[names[i]] = pk
		mu.Unlock()
	})
	parallel(len(g.Packages), func(i int) {
		p, e, w := c.enrich(ctx, g.Packages[i], packuments[g.Packages[i].Name])
		results[i] = result{p, e, w}
	})
	for i, r := range results {
		g.Packages[i] = r.p
		g.Evidence = append(g.Evidence, r.e...)
		g.Warnings = append(g.Warnings, r.w...)
	}
}

func parallel(n int, fn func(int)) {
	jobs := make(chan int)
	var wg sync.WaitGroup
	workers := Workers()
	if n < workers {
		workers = n
	}
	for worker := 0; worker < workers; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range jobs {
				fn(i)
			}
		}()
	}
	for i := 0; i < n; i++ {
		jobs <- i
	}
	close(jobs)
	wg.Wait()
}

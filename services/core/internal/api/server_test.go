package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/astra-security/astra/services/core/internal/model"
	"github.com/astra-security/astra/services/core/internal/registry"
	"github.com/astra-security/astra/services/core/internal/scanner"
	"github.com/astra-security/astra/services/core/internal/store"
)

func setup(t *testing.T) (*Server, *store.Memory) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	storage := store.NewMemory()
	s := New(ctx, Config{Token: "test", EnableDemo: true}, &scanner.Runner{Store: storage, Registry: registry.New(), Intelligence: scanner.NewIntelligence("http://127.0.0.1:1", "")})
	t.Cleanup(func() { cancel(); s.Wait() })
	return s, storage
}
func request(s *Server, method, path, body, token string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	return w
}
func TestAuthenticationAndInputRejection(t *testing.T) {
	s, _ := setup(t)
	for _, tc := range []struct {
		path, body, token string
		status            int
	}{{"/api/v1/scans", `{"source":"demo"}`, "", 401}, {"/api/v1/scans", `{"source":"invalid"}`, "test", 422}, {"/api/v1/scans", `{"source":"demo","risk":99}`, "test", 400}, {"/api/v1/scans", `{"source":"demo"} {}`, "test", 400}, {"/api/v1/scans", `{"source":"github","repository":"https://127.0.0.1/a/b"}`, "test", 403}, {"/api/v1/scans", `{"source":"demo","github_token":"ghp_test"}`, "test", 422}} {
		w := request(s, "POST", tc.path, tc.body, tc.token)
		if w.Code != tc.status {
			t.Errorf("got %d want %d: %s", w.Code, tc.status, w.Body.String())
		}
	}
}
func TestEventReplayAndGraphReadiness(t *testing.T) {
	s, storage := setup(t)
	scan := &model.Scan{ID: "a", Status: "completed", Events: []model.Event{{ID: 1, Type: "SCAN_CREATED", Time: time.Now()}, {ID: 2, Type: "SCAN_COMPLETED", Time: time.Now()}}}
	_ = storage.Save(context.Background(), scan)
	r := httptest.NewRequest("GET", "/api/v1/scans/a/events", nil)
	r.Header.Set("Authorization", "Bearer test")
	r.Header.Set("Last-Event-ID", "1")
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if w.Code != 200 || strings.Contains(w.Body.String(), "SCAN_CREATED") || !strings.Contains(w.Body.String(), "id: 2") {
		t.Fatalf("replay failed: %s", w.Body.String())
	}
	if w := request(s, "GET", "/api/v1/scans/a/graph", "", "test"); w.Code != 409 {
		t.Fatal("premature graph response")
	}
	if w := request(s, "GET", "/api/v1/scans/missing", "", "test"); w.Code != 404 {
		t.Fatal("missing scan response")
	}
}
func TestFailedIntelligencePreservesGraphAndTerminalEvent(t *testing.T) {
	s, storage := setup(t)
	w := request(s, "POST", "/api/v1/scans", `{"source":"demo"}`, "test")
	if w.Code != 202 {
		t.Fatal(w.Body.String())
	}
	var accepted map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &accepted)
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		scan, _ := storage.Get(context.Background(), accepted["scan_id"])
		if scan.Status == "failed" {
			if scan.Graph == nil || scan.Events[len(scan.Events)-1].Type != "SCAN_FAILED" {
				t.Fatal("failed scan lost evidence")
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("scan did not reach terminal state")
}
func TestGETScanOmitsStoredLockfile(t *testing.T) {
	s, storage := setup(t)
	_ = storage.Save(context.Background(), &model.Scan{
		ID:       "lock",
		Status:   "completed",
		Manifest: json.RawMessage(`{"name":"hidden"}`),
		Lockfile: json.RawMessage(`{"lockfileVersion":3}`),
	})
	w := request(s, "GET", "/api/v1/scans/lock", "", "test")
	if w.Code != 200 || strings.Contains(w.Body.String(), "hidden") || strings.Contains(w.Body.String(), "lockfileVersion") {
		t.Fatalf("lockfile leaked: %s", w.Body.String())
	}
}
func TestListScansOmitsLockfileAndAcceptsStatusFilter(t *testing.T) {
	s, storage := setup(t)
	_ = storage.Save(context.Background(), &model.Scan{
		ID: "a", Source: "demo", Status: "completed", CreatedAt: time.Now().Add(-time.Hour),
		Lockfile: json.RawMessage(`{"lockfileVersion":3}`),
	})
	_ = storage.Save(context.Background(), &model.Scan{ID: "b", Source: "lockfile", Status: "running", CreatedAt: time.Now()})
	w := request(s, "GET", "/api/v1/scans", "", "test")
	if w.Code != 200 || strings.Contains(w.Body.String(), "lockfileVersion") {
		t.Fatalf("list %d %s", w.Code, w.Body.String())
	}
	var body struct {
		Scans []model.ScanSummary `json:"scans"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if len(body.Scans) != 2 || body.Scans[0].ID != "b" {
		t.Fatalf("scans %+v", body.Scans)
	}
	filtered := request(s, "GET", "/api/v1/scans?status=running", "", "test")
	_ = json.Unmarshal(filtered.Body.Bytes(), &body)
	if filtered.Code != 200 || len(body.Scans) != 1 || body.Scans[0].ID != "b" {
		t.Fatalf("filter %s", filtered.Body.String())
	}
	if w := request(s, "GET", "/api/v1/scans?status=nope", "", "test"); w.Code != 422 {
		t.Fatalf("invalid status %d", w.Code)
	}
}
func TestCannotOverrideStoredEvidenceViaAction(t *testing.T) {
	s, storage := setup(t)
	_ = storage.Save(context.Background(), &model.Scan{ID: "a", Status: "completed", Graph: &model.Graph{}})
	w := request(s, http.MethodPost, "/api/v1/scans/a/remediation", `{"graph":{}}`, "test")
	if w.Code != 422 {
		t.Fatal("caller could replace stored evidence")
	}
}
func TestVerifyRejectsDemoAndRequiresMultipart(t *testing.T) {
	s, storage := setup(t)
	_ = storage.Save(context.Background(), &model.Scan{ID: "demo", Source: "demo", Status: "completed", Graph: &model.Graph{}})
	if w := request(s, http.MethodPost, "/api/v1/scans/demo/verify", `{"max_changes":1}`, "test"); w.Code != 422 {
		t.Fatalf("demo verify %d %s", w.Code, w.Body.String())
	}
	_ = storage.Save(context.Background(), &model.Scan{ID: "lock", Source: "lockfile", Status: "completed", Graph: &model.Graph{}})
	if w := request(s, http.MethodPost, "/api/v1/scans/lock/verify", `{"max_changes":1}`, "test"); w.Code != 415 {
		t.Fatalf("json verify %d %s", w.Code, w.Body.String())
	}
}
func TestStatusRequiresAuthAndReportsUsage(t *testing.T) {
	s, _ := setup(t)
	if w := request(s, "GET", "/api/v1/status", "", ""); w.Code != 401 {
		t.Fatalf("unauthenticated status %d", w.Code)
	}
	request(s, "GET", "/health", "", "")
	request(s, "GET", "/api/v1/scans", "", "test")
	if w := request(s, "GET", "/api/v1/scans/as_deadbeef/graph", "", "test"); w.Code != 404 {
		t.Fatalf("missing scan graph %d", w.Code)
	}
	w := request(s, "GET", "/api/v1/status", "", "test")
	if w.Code != 200 {
		t.Fatalf("status %d %s", w.Code, w.Body.String())
	}
	var body struct {
		Service   string `json:"service"`
		Endpoints []struct {
			Method, Path string
			Usage        struct {
				Count      int `json:"count"`
				Errors     int `json:"errors"`
				LastStatus int `json:"last_status"`
			} `json:"usage"`
		} `json:"endpoints"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body.Service != "astra-core" || len(body.Endpoints) != len(routes) {
		t.Fatalf("endpoints %d want %d: %s", len(body.Endpoints), len(routes), w.Body.String())
	}
	seen := map[string]int{}
	for _, e := range body.Endpoints {
		seen[e.Method+" "+e.Path] = e.Usage.Count
		if e.Path == "/api/v1/scans/{id}/graph" && (e.Usage.Count != 1 || e.Usage.Errors != 1 || e.Usage.LastStatus != 404) {
			t.Fatalf("graph usage %+v", e.Usage)
		}
	}
	for _, key := range []string{"GET /health", "GET /api/v1/scans"} {
		if seen[key] < 1 {
			t.Fatalf("%s not counted: %v", key, seen)
		}
	}
}

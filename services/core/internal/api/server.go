package api

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"path"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	gitinput "github.com/astra-security/astra/services/core/internal/git"
	"github.com/astra-security/astra/services/core/internal/model"
	"github.com/astra-security/astra/services/core/internal/resolver"
	"github.com/astra-security/astra/services/core/internal/scanner"
	"github.com/astra-security/astra/services/core/internal/store"
)

// Version is reported by GET /api/v1/status; override with -ldflags "-X .../api.Version=x".
var Version = "dev"

type Config struct {
	Token                                string
	EnableGitHub, EnableDemo             bool
	Storage                              string // "memory" or "postgres"
	VerifierConfigured, SarvamConfigured bool
}
type job struct {
	id    string
	input model.ScanInput
}

// route is a documented endpoint; the key METHOD+" "+Path indexes usage counters.
type route struct {
	Method, Path, Description string
	Auth                      bool
}

var routes = []route{
	{"GET", "/health", "API liveness", false},
	{"GET", "/ready", "Database and intelligence readiness", true},
	{"GET", "/metrics", "Prometheus-format request count and queued/running scan gauge", true},
	{"GET", "/api/v1/status", "Endpoint inventory, dependency health and per-route usage counters", true},
	{"GET", "/api/v1/scans", "Scan summaries, newest first (limit 1-200, optional status)", true},
	{"POST", "/api/v1/scans", "Validate input, persist queued state, return 202 and scan ID", true},
	{"GET", "/api/v1/scans/{id}", "Scan status, analysis summary/results, events; graph fetched separately", true},
	{"GET", "/api/v1/scans/{id}/events", "SSE stream; supports Last-Event-ID replay", true},
	{"GET", "/api/v1/scans/{id}/graph", "Normalized packages, edges, evidence and warnings; available during scan", true},
	{"GET", "/api/v1/scans/{id}/findings", "Findings and project summary after analysis", true},
	{"GET", "/api/v1/scans/{id}/evidence", "Evidence records", true},
	{"POST", "/api/v1/scans/{id}/simulate", "Hypothetical compromise of a stored package instance", true},
	{"POST", "/api/v1/scans/{id}/remediation", "Candidate remediation plan", true},
	{"POST", "/api/v1/scans/{id}/verify", "Isolated test/build check for a proposal", true},
	{"POST", "/api/v1/scans/{id}/explain", "Evidence interpretation for one package", true},
}

// ponytail: in-memory counters, reset on restart; persist to store if history matters
type routeUsage struct {
	Count, Errors int
	LastStatus    int
	LastSeen      time.Time
	TotalMs       int64
}
type Server struct {
	config   Config
	runner   *scanner.Runner
	mux      *http.ServeMux
	jobs     chan job
	slots    chan struct{}
	streams  chan struct{}
	requests chan struct{}
	wg       sync.WaitGroup
	count    atomic.Uint64
	ctx      context.Context
	started  time.Time
	usageMu  sync.Mutex
	usage    map[string]*routeUsage
}

func New(ctx context.Context, config Config, runner *scanner.Runner) *Server {
	s := &Server{config: config, runner: runner, mux: http.NewServeMux(), jobs: make(chan job, 18), slots: make(chan struct{}, 18), streams: make(chan struct{}, 16), requests: make(chan struct{}, 32), ctx: ctx, started: time.Now(), usage: map[string]*routeUsage{}}
	s.mux.HandleFunc("GET /api/v1/status", s.status)
	s.mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		respond(w, 200, map[string]string{"status": "ok", "service": "astra-core"})
	})
	s.mux.HandleFunc("GET /ready", s.ready)
	s.mux.HandleFunc("GET /metrics", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4")
		fmt.Fprintf(w, "# TYPE astra_http_requests_total counter\nastra_http_requests_total %d\n# TYPE astra_scan_jobs gauge\nastra_scan_jobs %d\n", s.count.Load(), len(s.slots))
	})
	s.mux.HandleFunc("POST /api/v1/scans", s.create)
	s.mux.HandleFunc("GET /api/v1/scans", s.list)
	s.mux.HandleFunc("GET /api/v1/scans/{scanID}", s.get)
	s.mux.HandleFunc("GET /api/v1/scans/{scanID}/{resource}", s.resource)
	s.mux.HandleFunc("POST /api/v1/scans/{scanID}/{action}", s.action)
	for i := 0; i < 2; i++ {
		s.wg.Add(1)
		go func() {
			defer s.wg.Done()
			for {
				select {
				case <-ctx.Done():
					return
				case j := <-s.jobs:
					s.runner.Run(ctx, j.id, j.input)
					<-s.slots
				}
			}
		}()
	}
	return s
}
func (s *Server) Wait() { s.wg.Wait() }

// statusRecorder captures the response status for usage counters.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (w *statusRecorder) WriteHeader(code int) {
	if w.status == 0 {
		w.status = code
	}
	w.ResponseWriter.WriteHeader(code)
}
func (w *statusRecorder) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = 200
	}
	return w.ResponseWriter.Write(b)
}
func (w *statusRecorder) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}
func (w *statusRecorder) Unwrap() http.ResponseWriter { return w.ResponseWriter }

// routeKey maps a request to its documented route key, replacing the scan ID segment with {id}.
func routeKey(method, p string) string {
	if rest, ok := strings.CutPrefix(p, "/api/v1/scans/"); ok {
		id, tail, _ := strings.Cut(rest, "/")
		if hexID, ok := strings.CutPrefix(id, "as_"); ok {
			if _, err := hex.DecodeString(hexID); err == nil && hexID != "" {
				p = "/api/v1/scans/{id}"
				if tail != "" {
					p += "/" + tail
				}
			}
		}
	}
	key := method + " " + p
	for _, rt := range routes {
		if rt.Method+" "+rt.Path == key {
			return key
		}
	}
	return "other"
}
func (s *Server) record(key string, status int, elapsed time.Duration) {
	s.usageMu.Lock()
	defer s.usageMu.Unlock()
	u := s.usage[key]
	if u == nil {
		u = &routeUsage{}
		s.usage[key] = u
	}
	u.Count++
	if status >= 400 {
		u.Errors++
	}
	u.LastStatus = status
	u.LastSeen = time.Now().UTC()
	u.TotalMs += elapsed.Milliseconds()
}
func (s *Server) ServeHTTP(rw http.ResponseWriter, r *http.Request) {
	started := time.Now()
	w := &statusRecorder{ResponseWriter: rw}
	requestID := newID("req_")
	w.Header().Set("X-Request-ID", requestID)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	s.count.Add(1)
	defer func() {
		if recovered := recover(); recovered != nil {
			slog.Error("request_panic", "request_id", requestID)
			problem(w, 500, "internal_error", "Request could not be completed")
		}
		s.record(routeKey(r.Method, r.URL.Path), w.status, time.Since(started))
		slog.Info("http_request", "request_id", requestID, "method", r.Method, "path", r.URL.Path, "duration_ms", time.Since(started).Milliseconds())
	}()
	if r.URL.Path != "/health" && s.config.Token != "" && subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+s.config.Token)) != 1 {
		problem(w, 401, "unauthorized", "A valid bearer token is required")
		return
	}
	select {
	case s.requests <- struct{}{}:
		defer func() { <-s.requests }()
	default:
		problem(w, 429, "busy", "API concurrency limit reached")
		return
	}
	s.mux.ServeHTTP(w, r)
}
func newID(prefix string) string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return prefix + hex.EncodeToString(b[:])
}
func respond(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func problem(w http.ResponseWriter, status int, code, message string) {
	respond(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}
func decode(w http.ResponseWriter, r *http.Request, out any, limit int64) bool {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		problem(w, 415, "content_type", "Use application/json")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		var size *http.MaxBytesError
		if errors.As(err, &size) {
			problem(w, 413, "input_too_large", "Request body exceeds the input budget")
		} else {
			problem(w, 400, "invalid_json", "Invalid JSON body or unsupported field")
		}
		return false
	}
	if err := d.Decode(new(any)); err != io.EOF {
		problem(w, 400, "invalid_json", "Exactly one JSON object is required")
		return false
	}
	return true
}
func (s *Server) probe(ctx context.Context) (storeErr, intelligenceErr error) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	return s.runner.Store.Ready(ctx), s.runner.Intelligence.Ready(ctx)
}
func (s *Server) ready(w http.ResponseWriter, r *http.Request) {
	if storeErr, intelligenceErr := s.probe(r.Context()); storeErr != nil || intelligenceErr != nil {
		problem(w, 503, "not_ready", "Storage or intelligence service is unavailable")
		return
	}
	respond(w, 200, map[string]string{"status": "ready"})
}
func (s *Server) status(w http.ResponseWriter, r *http.Request) {
	storeErr, intelligenceErr := s.probe(r.Context())
	dependency := func(err error) map[string]any {
		msg := ""
		if err != nil {
			msg = err.Error()
		}
		return map[string]any{"ok": err == nil, "error": msg}
	}
	admitted, queued := len(s.slots), len(s.jobs)
	running := max(admitted-queued, 0)
	endpoints := make([]map[string]any, 0, len(routes))
	s.usageMu.Lock()
	for _, rt := range routes {
		u := s.usage[rt.Method+" "+rt.Path]
		if u == nil {
			u = &routeUsage{}
		}
		var lastSeen any
		var avg int64
		if u.Count > 0 {
			lastSeen = u.LastSeen.Format(time.RFC3339)
			avg = u.TotalMs / int64(u.Count)
		}
		endpoints = append(endpoints, map[string]any{"method": rt.Method, "path": rt.Path, "description": rt.Description, "auth": rt.Auth,
			"usage": map[string]any{"count": u.Count, "errors": u.Errors, "last_status": u.LastStatus, "last_seen": lastSeen, "avg_ms": avg}})
	}
	s.usageMu.Unlock()
	respond(w, 200, map[string]any{
		"service": "astra-core", "version": Version, "time": time.Now().UTC().Format(time.RFC3339), "uptime_seconds": int64(time.Since(s.started).Seconds()),
		"config": map[string]any{"demo_enabled": s.config.EnableDemo, "github_enabled": s.config.EnableGitHub, "verifier_configured": s.config.VerifierConfigured, "storage": s.config.Storage,
			"queue": map[string]int{"workers": 2, "capacity": cap(s.slots), "running": running, "queued": queued}},
		"dependencies": map[string]any{"store": dependency(storeErr), "intelligence": dependency(intelligenceErr), "sarvam": map[string]bool{"configured": s.config.SarvamConfigured}},
		"endpoints":    endpoints,
	})
}
func (s *Server) create(w http.ResponseWriter, r *http.Request) {
	var input model.ScanInput
	if !decode(w, r, &input, 12*1024*1024) {
		return
	}
	if len(input.DeniedLicenses) > 100 {
		problem(w, 422, "invalid_policy", "At most 100 denied license identifiers are supported")
		return
	}
	if input.DeniedLicenses == nil {
		input.DeniedLicenses = []string{}
	}
	if input.Sources == nil {
		input.Sources = map[string]string{}
	}
	switch input.Source {
	case "demo":
		if !s.config.EnableDemo {
			problem(w, 403, "demo_disabled", "Demo scans are disabled")
			return
		}
		if input.GitHubToken != "" {
			problem(w, 422, "mixed_sources", "github_token is only valid for GitHub scans")
			return
		}
	case "github":
		if !s.config.EnableGitHub {
			problem(w, 403, "github_disabled", "Enable ASTRA_ENABLE_GITHUB on an isolated deployment to fetch public or token-authenticated repositories")
			return
		}
		repository, err := gitinput.ValidateRepository(input.Repository)
		if err != nil {
			problem(w, 422, "invalid_repository", err.Error())
			return
		}
		input.Repository = repository
		if _, err := gitinput.AuthorizationHeader(input.GitHubToken); err != nil {
			problem(w, 422, "invalid_token", err.Error())
			return
		}
		if len(input.Manifest) > 0 || len(input.Lockfile) > 0 || len(input.Sources) > 0 {
			problem(w, 422, "mixed_sources", "GitHub scans cannot include inline source inputs")
			return
		}
	case "lockfile":
		if input.GitHubToken != "" {
			problem(w, 422, "mixed_sources", "github_token is only valid for GitHub scans")
			return
		}
		if input.Repository != "" {
			problem(w, 422, "mixed_sources", "Lockfile scans cannot specify a repository URL")
			return
		}
		if _, err := resolver.Parse(input.Manifest, input.Lockfile); err != nil {
			problem(w, 422, "invalid_lockfile", err.Error())
			return
		}
	default:
		problem(w, 422, "invalid_source", "source must be lockfile, github, or demo")
		return
	}
	total := 0
	for file, content := range input.Sources {
		total += len(content)
		if len(file) > 512 || path.IsAbs(file) || path.Clean(file) != file || strings.HasPrefix(file, "../") || strings.ContainsAny(file, "\\\x00\n\r") || strings.Contains(file, "node_modules/") {
			problem(w, 422, "invalid_source_path", "Source paths must be relative project files outside node_modules")
			return
		}
	}
	if total > 4*1024*1024 || len(input.Sources) > 500 {
		problem(w, 413, "source_budget", "Source budget is 500 files and 4 MiB")
		return
	}
	if s.ctx.Err() != nil {
		problem(w, 503, "shutting_down", "Service is shutting down")
		return
	}
	select {
	case s.slots <- struct{}{}:
	default:
		w.Header().Set("Retry-After", "5")
		problem(w, 429, "queue_full", "Scan queue is full; retry shortly")
		return
	}
	now := time.Now().UTC()
	scan := &model.Scan{ID: newID("as_"), Source: input.Source, Repository: input.Repository, Status: "queued", CreatedAt: now, UpdatedAt: now, DeniedLicenses: input.DeniedLicenses, Events: []model.Event{{ID: 1, Type: "SCAN_CREATED", Stage: "queued", Message: "Scan accepted", Time: now}}}
	if err := s.runner.Store.Save(r.Context(), scan); err != nil {
		<-s.slots
		problem(w, 503, "storage_unavailable", "Could not persist scan; memory mode retains at most 1000 scans")
		return
	}
	s.jobs <- job{scan.ID, input}
	w.Header().Set("Location", "/api/v1/scans/"+scan.ID)
	respond(w, 202, map[string]string{"scan_id": scan.ID, "status": "queued", "events_url": "/api/v1/scans/" + scan.ID + "/events"})
}
func (s *Server) list(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 200 {
			problem(w, 422, "invalid_limit", "limit must be an integer from 1 to 200")
			return
		}
		limit = n
	}
	status := r.URL.Query().Get("status")
	switch status {
	case "", "queued", "running", "completed", "partial", "failed":
	default:
		problem(w, 422, "invalid_status", "status must be queued, running, completed, partial, or failed")
		return
	}
	scans, err := s.runner.Store.List(r.Context(), limit, status)
	if err != nil {
		problem(w, 503, "storage_unavailable", "Scan storage is unavailable")
		return
	}
	if scans == nil {
		scans = []model.ScanSummary{}
	}
	respond(w, 200, map[string]any{"scans": scans})
}
func (s *Server) load(w http.ResponseWriter, r *http.Request) *model.Scan {
	scan, err := s.runner.Store.Get(r.Context(), r.PathValue("scanID"))
	if errors.Is(err, store.ErrNotFound) {
		problem(w, 404, "scan_not_found", "Scan does not exist")
		return nil
	}
	if err != nil {
		problem(w, 503, "storage_unavailable", "Scan storage is unavailable")
		return nil
	}
	return scan
}
func (s *Server) get(w http.ResponseWriter, r *http.Request) {
	scan := s.load(w, r)
	if scan == nil {
		return
	}
	scan.Graph = nil
	scan.Manifest = nil
	scan.Lockfile = nil
	respond(w, 200, scan)
}
func (s *Server) resource(w http.ResponseWriter, r *http.Request) {
	scan := s.load(w, r)
	if scan == nil {
		return
	}
	resource := r.PathValue("resource")
	if resource == "events" {
		s.events(w, r, scan)
		return
	}
	if resource != "graph" && resource != "findings" && resource != "evidence" {
		problem(w, 404, "not_found", "Unknown scan resource")
		return
	}
	if scan.Graph == nil {
		problem(w, 409, "scan_not_ready", "Dependency graph is not available yet")
		return
	}
	switch resource {
	case "graph":
		respond(w, 200, scan.Graph)
	case "evidence":
		respond(w, 200, map[string]any{"evidence": scan.Graph.Evidence})
	case "findings":
		if len(scan.Analysis) == 0 {
			problem(w, 409, "analysis_not_ready", "Analysis has not completed")
			return
		}
		var a map[string]json.RawMessage
		_ = json.Unmarshal(scan.Analysis, &a)
		respond(w, 200, map[string]any{"findings": a["findings"], "summary": a["summary"]})
	}
}
func (s *Server) action(w http.ResponseWriter, r *http.Request) {
	if r.PathValue("action") == "verify" {
		s.verify(w, r)
		return
	}
	action := r.PathValue("action")
	allowed := map[string]map[string]bool{
		"simulate":    {"package_id": true, "ci_install": true, "lifecycle_scripts_enabled": true, "credential_categories": true},
		"remediation": {"max_changes": true}, "explain": {"package_id": true, "language": true, "use_ai": true}}
	fields, ok := allowed[action]
	if !ok {
		problem(w, 404, "not_found", "Unknown scan action")
		return
	}
	scan := s.load(w, r)
	if scan == nil {
		return
	}
	if scan.Status != "completed" && scan.Status != "partial" {
		problem(w, 409, "scan_not_ready", "Wait for a completed or partial scan")
		return
	}
	payload := map[string]any{}
	if !decode(w, r, &payload, 16*1024) {
		return
	}
	if payload == nil {
		problem(w, 422, "invalid_action", "Action body must be an object")
		return
	}
	for k := range payload {
		if !fields[k] {
			problem(w, 422, "invalid_action", "Unsupported action field: "+k)
			return
		}
	}
	if action != "remediation" {
		id, ok := payload["package_id"].(string)
		found := false
		for _, p := range scan.Graph.Packages {
			if p.ID == id {
				found = true
				break
			}
		}
		if !ok || !found {
			problem(w, 404, "package_not_found", "Package instance does not exist in this scan")
			return
		}
	}
	payload["graph"] = scan.Graph
	payload["denied_licenses"] = scan.DeniedLicenses
	var result json.RawMessage
	if err := s.runner.Intelligence.Call(r.Context(), "/v1/"+action, payload, &result); err != nil {
		var upstream *scanner.UpstreamError
		if errors.As(err, &upstream) && upstream.Status == 422 {
			problem(w, 422, "invalid_action", "Action parameters failed schema validation")
		} else {
			problem(w, 502, "intelligence_unavailable", err.Error())
		}
		return
	}
	if action == "remediation" {
		predicted, err := s.runner.AttachPrediction(r.Context(), scan, result)
		if err != nil {
			problem(w, 502, "intelligence_unavailable", err.Error())
			return
		}
		result = predicted
	}
	respond(w, 200, result)
}

func (s *Server) verify(w http.ResponseWriter, r *http.Request) {
	scan := s.load(w, r)
	if scan == nil {
		return
	}
	if scan.Status != "completed" && scan.Status != "partial" {
		problem(w, 409, "scan_not_ready", "Wait for a completed or partial scan")
		return
	}
	if scan.Source == "demo" {
		problem(w, 422, "demo_unverified", "Demo fixture packages are synthetic and cannot be build-verified")
		return
	}
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
		problem(w, 415, "content_type", "Use multipart/form-data with a project ZIP")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 9<<20)
	if err := r.ParseMultipartForm(9 << 20); err != nil {
		problem(w, 413, "input_too_large", "Request body exceeds the input budget")
		return
	}
	maxChanges, err := strconv.Atoi(r.FormValue("max_changes"))
	if err != nil || maxChanges < 1 || maxChanges > 100 {
		problem(w, 422, "invalid_action", "max_changes must be an integer from 1 to 100")
		return
	}
	file, _, err := r.FormFile("project")
	if err != nil {
		problem(w, 422, "invalid_project", "project ZIP is required")
		return
	}
	zipBytes, err := io.ReadAll(io.LimitReader(file, 8<<20+1))
	_ = file.Close()
	if err != nil || len(zipBytes) > 8<<20 {
		problem(w, 413, "input_too_large", "Request body exceeds the input budget")
		return
	}
	if _, err := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes))); err != nil {
		problem(w, 422, "invalid_project", "project must be a ZIP archive")
		return
	}
	payload := map[string]any{"max_changes": maxChanges, "graph": scan.Graph, "denied_licenses": scan.DeniedLicenses}
	var result json.RawMessage
	if err := s.runner.Intelligence.Call(r.Context(), "/v1/remediation", payload, &result); err != nil {
		var upstream *scanner.UpstreamError
		if errors.As(err, &upstream) && upstream.Status == 422 {
			problem(w, 422, "invalid_action", "Action parameters failed schema validation")
		} else {
			problem(w, 502, "intelligence_unavailable", err.Error())
		}
		return
	}
	verified, err := s.runner.AttachVerification(r.Context(), scan, result, zipBytes)
	if err != nil {
		problem(w, 422, "invalid_project", err.Error())
		return
	}
	respond(w, 200, verified)
}
func terminal(status string) bool {
	return status == "completed" || status == "partial" || status == "failed"
}
func (s *Server) events(w http.ResponseWriter, r *http.Request, scan *model.Scan) {
	select {
	case s.streams <- struct{}{}:
		defer func() { <-s.streams }()
	default:
		problem(w, 429, "stream_limit", "Event stream limit reached")
		return
	}
	last := 0
	if h := r.Header.Get("Last-Event-ID"); h != "" {
		n, err := strconv.Atoi(h)
		if err != nil || n < 0 {
			problem(w, 400, "invalid_event_id", "Last-Event-ID must be a nonnegative integer")
			return
		}
		last = n
	}
	if last > len(scan.Events) {
		problem(w, 400, "invalid_event_id", "Last-Event-ID is ahead of this scan")
		return
	}
	controller := http.NewResponseController(w)
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("X-Accel-Buffering", "no")
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		_ = controller.SetWriteDeadline(time.Now().Add(20 * time.Second))
		for _, event := range scan.Events {
			if event.ID > last {
				data, _ := json.Marshal(event)
				if _, err := fmt.Fprintf(w, "id: %d\nevent: %s\ndata: %s\n\n", event.ID, event.Type, data); err != nil {
					return
				}
				last = event.ID
			}
		}
		if err := controller.Flush(); err != nil {
			return
		}
		if terminal(scan.Status) {
			return
		}
		select {
		case <-r.Context().Done():
			return
		case <-s.ctx.Done():
			return
		case <-heartbeat.C:
			if _, err := fmt.Fprint(w, ": heartbeat\n\n"); err != nil {
				return
			}
		case <-ticker.C:
			next, err := s.runner.Store.Get(r.Context(), scan.ID)
			if err != nil {
				return
			}
			scan = next
		}
	}
}

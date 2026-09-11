package sandbox

import (
	"crypto/subtle"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"time"
)

type Server struct {
	Token  string
	Runner *Runner
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	if r.URL.Path == "/health" {
		writeJSON(w, 200, map[string]string{"status": "ok", "service": "astra-verifier"})
		return
	}
	if s.Token != "" && subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+s.Token)) != 1 {
		writeJSON(w, 401, map[string]any{"error": map[string]string{"code": "unauthorized", "message": "A valid bearer token is required"}})
		return
	}
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/ready":
		ctx := r.Context()
		if err := s.Runner.Available(ctx); err != nil {
			writeJSON(w, 503, map[string]any{"error": map[string]string{"code": "not_ready", "message": "Docker engine is not available"}})
			return
		}
		writeJSON(w, 200, map[string]string{"status": "ready", "service": "astra-verifier"})
	case r.Method == http.MethodPost && r.URL.Path == "/v1/verify":
		s.verify(w, r)
	default:
		writeJSON(w, 404, map[string]any{"error": map[string]string{"code": "not_found", "message": "Unknown verifier route"}})
	}
}

func (s *Server) verify(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxCompressedBytes+4<<20)
	if err := r.ParseMultipartForm(maxCompressedBytes + 1<<20); err != nil {
		writeJSON(w, 413, map[string]any{"error": map[string]string{"code": "input_too_large", "message": "Verification payload exceeds the input budget"}})
		return
	}
	zipBytes, err := readMultipartFile(r, "project")
	if err != nil {
		writeJSON(w, 400, map[string]any{"error": map[string]string{"code": "invalid_project", "message": "project ZIP is required"}})
		return
	}
	req := Request{
		Zip:              zipBytes,
		OriginalLockfile: []byte(r.FormValue("original_lockfile")),
		OriginalManifest: []byte(r.FormValue("original_manifest")),
		BumpedManifest:   []byte(r.FormValue("bumped_manifest")),
		BumpedLockfile:   []byte(r.FormValue("bumped_lockfile")),
	}
	out, err := Run(r.Context(), s.Runner, req)
	if err != nil {
		writeJSON(w, 422, map[string]any{"error": map[string]string{"code": "invalid_project", "message": err.Error()}})
		return
	}
	slog.Info("verify_job", "passed", out.Passed, "install_ok", out.InstallOK)
	writeJSON(w, 200, out)
}

func readMultipartFile(r *http.Request, name string) ([]byte, error) {
	file, _, err := r.FormFile(name)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	return io.ReadAll(io.LimitReader(file, maxCompressedBytes+1))
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func NewHTTPServer(addr, token string, runner *Runner) *http.Server {
	return &http.Server{Addr: addr, Handler: &Server{Token: token, Runner: runner}, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 2 * time.Minute, WriteTimeout: 12 * time.Minute, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 * 1024}
}

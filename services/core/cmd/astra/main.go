package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/astra-security/astra/services/core/internal/api"
	"github.com/astra-security/astra/services/core/internal/registry"
	"github.com/astra-security/astra/services/core/internal/sandbox"
	"github.com/astra-security/astra/services/core/internal/scanner"
	"github.com/astra-security/astra/services/core/internal/store"
)

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
func main() {
	if err := run(); err != nil {
		slog.Error("startup_failed", "error", err)
		os.Exit(1)
	}
}
func run() error {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	address := env("ASTRA_ADDR", "127.0.0.1:8080")
	token := os.Getenv("ASTRA_API_TOKEN")
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return err
	}
	ip := net.ParseIP(host)
	if token == "" && (ip == nil || !ip.IsLoopback()) {
		return errors.New("ASTRA_API_TOKEN is required when binding outside loopback")
	}
	var storage store.Store = store.NewMemory()
	storageKind := "memory"
	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		storageKind = "postgres"
		setup, cancel := context.WithTimeout(ctx, 15*time.Second)
		retention, rerr := store.ParseRetention(os.Getenv("ASTRA_SCAN_RETENTION_AGE"), os.Getenv("ASTRA_SCAN_RETENTION_COUNT"))
		if rerr != nil {
			cancel()
			return rerr
		}
		storage, err = store.NewPostgres(setup, dsn, retention)
		cancel()
		if err != nil {
			return err
		}
		slog.Info("using_postgres_storage", "retention_age", retention.MaxAge.String(), "retention_count", retention.MaxCount)
	} else {
		slog.Warn("using_ephemeral_memory_storage", "retained_scans", 1000)
	}
	defer storage.Close()
	intelligence := scanner.NewIntelligence(env("ASTRA_INTELLIGENCE_URL", "http://127.0.0.1:8000"), os.Getenv("ASTRA_INTERNAL_TOKEN"))
	var verifier *sandbox.Client
	if u := os.Getenv("ASTRA_VERIFIER_URL"); u != "" {
		verifier = sandbox.NewClient(u, os.Getenv("ASTRA_INTERNAL_TOKEN"))
	}
	runner := &scanner.Runner{Store: storage, Registry: registry.New(), Intelligence: intelligence, Verifier: verifier}
	handler := api.New(ctx, api.Config{Token: token, EnableDemo: env("ASTRA_ENABLE_DEMO", "true") == "true", EnableGitHub: os.Getenv("ASTRA_ENABLE_GITHUB") == "true",
		Storage: storageKind, VerifierConfigured: verifier != nil, SarvamConfigured: os.Getenv("SARVAM_API_KEY") != ""}, runner)
	server := &http.Server{Addr: address, Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 2 * time.Minute, WriteTimeout: 12 * time.Minute, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 * 1024}
	failure := make(chan error, 1)
	go func() { slog.Info("listening", "address", address); failure <- server.ListenAndServe() }()
	select {
	case err = <-failure:
		stop()
	case <-ctx.Done():
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = server.Shutdown(shutdown)
	handler.Wait()
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

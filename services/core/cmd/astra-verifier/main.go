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

	"github.com/astra-security/astra/services/core/internal/sandbox"
)

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	address := env("ASTRA_VERIFIER_ADDR", "127.0.0.1:8090")
	token := os.Getenv("ASTRA_INTERNAL_TOKEN")
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		slog.Error("startup_failed", "error", err)
		os.Exit(1)
	}
	ip := net.ParseIP(host)
	if token == "" && (ip == nil || !ip.IsLoopback()) {
		slog.Error("startup_failed", "error", "ASTRA_INTERNAL_TOKEN is required when binding outside loopback")
		os.Exit(1)
	}
	server := sandbox.NewHTTPServer(address, token, sandbox.NewRunner())
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	failure := make(chan error, 1)
	go func() {
		slog.Info("listening", "address", address, "service", "astra-verifier")
		failure <- server.ListenAndServe()
	}()
	select {
	case err = <-failure:
		stop()
	case <-ctx.Done():
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = server.Shutdown(shutdown)
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("server_exit", "error", err)
		os.Exit(1)
	}
}

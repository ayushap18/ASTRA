package store

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/astra-security/astra/services/core/internal/model"
)

func TestIDsToDeleteNeverRemovesQueuedOrRunning(t *testing.T) {
	now := time.Date(2026, 9, 11, 12, 0, 0, 0, time.UTC)
	got := idsToDelete([]scanMeta{
		{ID: "queued", Status: "queued", UpdatedAt: now.Add(-1000 * time.Hour)},
		{ID: "running", Status: "running", UpdatedAt: now.Add(-1000 * time.Hour)},
		{ID: "old", Status: "completed", UpdatedAt: now.Add(-48 * time.Hour)},
	}, now, Retention{MaxAge: 24 * time.Hour})
	if len(got) != 1 || got[0] != "old" {
		t.Fatalf("got %v", got)
	}
}

func TestIDsToDeleteByMaxCountKeepsNewestPrunable(t *testing.T) {
	now := time.Date(2026, 9, 11, 12, 0, 0, 0, time.UTC)
	got := idsToDelete([]scanMeta{
		{ID: "a", Status: "completed", UpdatedAt: now.Add(-3 * time.Hour)},
		{ID: "b", Status: "failed", UpdatedAt: now.Add(-2 * time.Hour)},
		{ID: "c", Status: "partial", UpdatedAt: now.Add(-1 * time.Hour)},
		{ID: "live", Status: "running", UpdatedAt: now.Add(-4 * time.Hour)},
	}, now, Retention{MaxCount: 1})
	if len(got) != 2 || got[0] != "a" || got[1] != "b" {
		t.Fatalf("got %v want [a b]", got)
	}
}

func TestIDsToDeleteDisabledWhenZeroLimits(t *testing.T) {
	now := time.Now()
	got := idsToDelete([]scanMeta{
		{ID: "old", Status: "completed", UpdatedAt: now.Add(-1000 * time.Hour)},
	}, now, Retention{})
	if len(got) != 0 {
		t.Fatalf("got %v", got)
	}
}

func TestParseRetentionDefaults(t *testing.T) {
	r, err := ParseRetention("", "")
	if err != nil {
		t.Fatal(err)
	}
	if r.MaxAge != 720*time.Hour || r.MaxCount != 500 {
		t.Fatalf("defaults %+v", r)
	}
	off, err := ParseRetention("0", "0")
	if err != nil || off.MaxAge != 0 || off.MaxCount != 0 {
		t.Fatalf("off %+v %v", off, err)
	}
}

func TestMemoryListNewestFirstOmitsLockfileAndFiltersStatus(t *testing.T) {
	ctx := context.Background()
	s := NewMemory()
	older := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	newer := older.Add(time.Hour)
	if err := s.Save(ctx, &model.Scan{
		ID: "old", Source: "demo", Status: "completed", CreatedAt: older, UpdatedAt: older,
		Lockfile: json.RawMessage(`{"lockfileVersion":3}`),
		Manifest: json.RawMessage(`{"name":"hidden"}`),
		Analysis: json.RawMessage(`{"summary":{"risk":12}}`),
		Events:   []model.Event{{ID: 1, Stage: "queued", Progress: 0, Message: "accepted"}, {ID: 2, Stage: "completed", Progress: 100, Message: "done"}},
	}); err != nil {
		t.Fatal(err)
	}
	if err := s.Save(ctx, &model.Scan{ID: "live", Source: "lockfile", Status: "running", CreatedAt: newer, UpdatedAt: newer, Events: []model.Event{{ID: 1, Stage: "osv", Progress: 40, Message: "matching"}}}); err != nil {
		t.Fatal(err)
	}
	all, err := s.List(ctx, 50, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 2 || all[0].ID != "live" || all[1].ID != "old" {
		t.Fatalf("order %+v", all)
	}
	if all[1].Stage != "completed" || all[1].Progress != 100 || string(all[1].Summary) != `{"risk":12}` {
		t.Fatalf("summary %+v", all[1])
	}
	raw, _ := json.Marshal(all)
	if strings.Contains(string(raw), "lockfileVersion") || strings.Contains(string(raw), "hidden") {
		t.Fatalf("list leaked snapshot: %s", raw)
	}
	running, err := s.List(ctx, 50, "running")
	if err != nil || len(running) != 1 || running[0].ID != "live" {
		t.Fatalf("filter %+v %v", running, err)
	}
	capped, err := s.List(ctx, 1, "")
	if err != nil || len(capped) != 1 || capped[0].ID != "live" {
		t.Fatalf("limit %+v %v", capped, err)
	}
}

func TestMemorySnapshotsAreIsolated(t *testing.T) {
	ctx := context.Background()
	s := NewMemory()
	s.MaxScans = 1
	scan := &model.Scan{ID: "a", Status: "queued"}
	if err := s.Save(ctx, scan); err != nil {
		t.Fatal(err)
	}
	scan.Status = "mutated"
	got, _ := s.Get(ctx, "a")
	if got.Status != "queued" {
		t.Fatal("stored state aliases caller")
	}
	if !errors.Is(s.Save(ctx, &model.Scan{ID: "b"}), ErrCapacity) {
		t.Fatal("capacity not enforced")
	}
}
func TestPostgresRestartRecovery(t *testing.T) {
	dsn := os.Getenv("ASTRA_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("ASTRA_TEST_DATABASE_URL is not configured")
	}
	ctx := context.Background()
	s, err := NewPostgres(ctx, dsn, Retention{})
	if err != nil {
		t.Fatal(err)
	}
	scan := &model.Scan{ID: "test-recovery", Status: "running", CreatedAt: time.Now(), UpdatedAt: time.Now()}
	if err = s.Save(ctx, scan); err != nil {
		t.Fatal(err)
	}
	s.Close()
	s, err = NewPostgres(ctx, dsn, Retention{})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	got, err := s.Get(ctx, scan.ID)
	if err != nil || got.Status != "failed" {
		t.Fatalf("restart recovery: %+v %v", got, err)
	}
}

func TestPostgresPrunePreservesRunning(t *testing.T) {
	dsn := os.Getenv("ASTRA_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("ASTRA_TEST_DATABASE_URL is not configured")
	}
	ctx := context.Background()
	s, err := NewPostgres(ctx, dsn, Retention{MaxAge: 24 * time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	now := time.Now().UTC()
	old := &model.Scan{ID: "test-prune-old", Status: "completed", CreatedAt: now.Add(-48 * time.Hour), UpdatedAt: now.Add(-48 * time.Hour)}
	live := &model.Scan{ID: "test-prune-running", Status: "running", CreatedAt: now.Add(-48 * time.Hour), UpdatedAt: now.Add(-48 * time.Hour)}
	if err = s.Save(ctx, old); err != nil {
		t.Fatal(err)
	}
	if err = s.Save(ctx, live); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Get(ctx, old.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("old completed should be pruned: %v", err)
	}
	got, err := s.Get(ctx, live.ID)
	if err != nil || got.Status != "running" {
		t.Fatalf("running scan: %+v %v", got, err)
	}
}

package store

import (
	"context"
	"database/sql"
	_ "embed"
	"encoding/json"
	"errors"
	"sort"
	"sync"
	"time"

	"github.com/astra-security/astra/services/core/internal/model"
	_ "github.com/jackc/pgx/v5/stdlib"
)

var ErrNotFound = errors.New("scan not found")
var ErrCapacity = errors.New("scan retention limit reached")

type Store interface {
	Save(context.Context, *model.Scan) error
	Get(context.Context, string) (*model.Scan, error)
	List(context.Context, int, string) ([]model.ScanSummary, error)
	Ready(context.Context) error
	Close() error
}
type Memory struct {
	mu       sync.RWMutex
	scans    map[string][]byte
	MaxScans int
}

func NewMemory() *Memory { return &Memory{scans: map[string][]byte{}, MaxScans: 1000} }
func (m *Memory) Save(_ context.Context, s *model.Scan) error {
	data, err := json.Marshal(s)
	if err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, exists := m.scans[s.ID]; !exists && len(m.scans) >= m.MaxScans {
		return ErrCapacity
	}
	m.scans[s.ID] = data
	return nil
}
func (m *Memory) Get(_ context.Context, id string) (*model.Scan, error) {
	m.mu.RLock()
	data, ok := m.scans[id]
	m.mu.RUnlock()
	if !ok {
		return nil, ErrNotFound
	}
	var s model.Scan
	err := json.Unmarshal(data, &s)
	return &s, err
}
func (m *Memory) List(_ context.Context, limit int, status string) ([]model.ScanSummary, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	scans := make([]model.Scan, 0, len(m.scans))
	for _, data := range m.scans {
		var s model.Scan
		if err := json.Unmarshal(data, &s); err != nil {
			return nil, err
		}
		if status != "" && s.Status != status {
			continue
		}
		scans = append(scans, s)
	}
	sort.Slice(scans, func(i, j int) bool { return scans[i].CreatedAt.After(scans[j].CreatedAt) })
	if limit > 0 && len(scans) > limit {
		scans = scans[:limit]
	}
	out := make([]model.ScanSummary, 0, len(scans))
	for i := range scans {
		out = append(out, Summarize(&scans[i]))
	}
	return out, nil
}
func (m *Memory) Ready(context.Context) error { return nil }
func (m *Memory) Close() error                { return nil }

//go:embed migration.sql
var migration string

type Postgres struct {
	db          *sql.DB
	coordinator *sql.Conn
	retention   Retention
}

func NewPostgres(ctx context.Context, dsn string, retention Retention) (*Postgres, error) {
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(12)
	db.SetMaxIdleConns(4)
	db.SetConnMaxLifetime(30 * time.Minute)
	fail := func(err error) (*Postgres, error) { db.Close(); return nil, err }
	if err = db.PingContext(ctx); err != nil {
		return fail(err)
	}
	if _, err = db.ExecContext(ctx, migration); err != nil {
		return fail(err)
	}
	coordinator, err := db.Conn(ctx)
	if err != nil {
		return fail(err)
	}
	var acquired bool
	if err = coordinator.QueryRowContext(ctx, "SELECT pg_try_advisory_lock(728451902)").Scan(&acquired); err != nil || !acquired {
		coordinator.Close()
		if err == nil {
			err = errors.New("another Astra coordinator owns this database")
		}
		return fail(err)
	}
	p := &Postgres{db: db, coordinator: coordinator, retention: retention}
	rows, err := db.QueryContext(ctx, "SELECT document FROM astra_scans WHERE status IN ('queued','running')")
	if err != nil {
		p.Close()
		return nil, err
	}
	interrupted := []model.Scan{}
	for rows.Next() {
		var b []byte
		if err = rows.Scan(&b); err != nil {
			break
		}
		var s model.Scan
		if err = json.Unmarshal(b, &s); err != nil {
			break
		}
		interrupted = append(interrupted, s)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		p.Close()
		return nil, err
	}
	for _, s := range interrupted {
		s.Status = "failed"
		s.Error = "Service restarted before scan completion; resubmit the scan."
		s.UpdatedAt = time.Now().UTC()
		s.Events = append(s.Events, model.Event{ID: len(s.Events) + 1, Type: "SCAN_FAILED", Stage: "interrupted", Message: s.Error, Time: s.UpdatedAt})
		if err = p.Save(ctx, &s); err != nil {
			p.Close()
			return nil, err
		}
	}
	if err = p.prune(ctx, time.Now().UTC()); err != nil {
		p.Close()
		return nil, err
	}
	return p, nil
}
func (p *Postgres) Save(ctx context.Context, s *model.Scan) error {
	b, err := json.Marshal(s)
	if err != nil {
		return err
	}
	if _, err = p.db.ExecContext(ctx, `INSERT INTO astra_scans(id,status,created_at,updated_at,document) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,updated_at=EXCLUDED.updated_at,document=EXCLUDED.document`, s.ID, s.Status, s.CreatedAt, s.UpdatedAt, b); err != nil {
		return err
	}
	switch s.Status {
	case "completed", "failed", "partial":
		return p.prune(ctx, time.Now().UTC())
	}
	return nil
}
func (p *Postgres) Get(ctx context.Context, id string) (*model.Scan, error) {
	var b []byte
	err := p.db.QueryRowContext(ctx, "SELECT document FROM astra_scans WHERE id=$1", id).Scan(&b)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	var s model.Scan
	err = json.Unmarshal(b, &s)
	return &s, err
}
func (p *Postgres) List(ctx context.Context, limit int, status string) ([]model.ScanSummary, error) {
	if limit <= 0 {
		limit = 50
	}
	query := `SELECT document FROM astra_scans ORDER BY created_at DESC LIMIT $1`
	args := []any{limit}
	if status != "" {
		query = `SELECT document FROM astra_scans WHERE status=$1 ORDER BY created_at DESC LIMIT $2`
		args = []any{status, limit}
	}
	rows, err := p.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.ScanSummary{}
	for rows.Next() {
		var b []byte
		if err = rows.Scan(&b); err != nil {
			return nil, err
		}
		var s model.Scan
		if err = json.Unmarshal(b, &s); err != nil {
			return nil, err
		}
		out = append(out, Summarize(&s))
	}
	return out, rows.Err()
}
func (p *Postgres) Ready(ctx context.Context) error {
	if err := p.db.PingContext(ctx); err != nil {
		return err
	}
	var n int
	return p.coordinator.QueryRowContext(ctx, "SELECT 1").Scan(&n)
}
func (p *Postgres) Close() error {
	if p.coordinator != nil {
		_, _ = p.coordinator.ExecContext(context.Background(), "SELECT pg_advisory_unlock(728451902)")
		p.coordinator.Close()
	}
	return p.db.Close()
}

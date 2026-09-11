package store

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"time"
)

const (
	DefaultRetentionAge   = 720 * time.Hour
	DefaultRetentionCount = 500
)

type Retention struct {
	MaxAge   time.Duration
	MaxCount int
}

type scanMeta struct {
	ID        string
	Status    string
	UpdatedAt time.Time
}

func ParseRetention(age, count string) (Retention, error) {
	r := Retention{MaxAge: DefaultRetentionAge, MaxCount: DefaultRetentionCount}
	if age != "" {
		if age == "0" {
			r.MaxAge = 0
		} else {
			d, err := time.ParseDuration(age)
			if err != nil {
				return Retention{}, fmt.Errorf("ASTRA_SCAN_RETENTION_AGE: %w", err)
			}
			if d < 0 {
				return Retention{}, fmt.Errorf("ASTRA_SCAN_RETENTION_AGE must be >= 0")
			}
			r.MaxAge = d
		}
	}
	if count != "" {
		n, err := strconv.Atoi(count)
		if err != nil {
			return Retention{}, fmt.Errorf("ASTRA_SCAN_RETENTION_COUNT: %w", err)
		}
		if n < 0 {
			return Retention{}, fmt.Errorf("ASTRA_SCAN_RETENTION_COUNT must be >= 0")
		}
		r.MaxCount = n
	}
	return r, nil
}

func idsToDelete(items []scanMeta, now time.Time, r Retention) []string {
	if r.MaxAge <= 0 && r.MaxCount <= 0 {
		return nil
	}
	keep := make([]scanMeta, 0, len(items))
	var drop []scanMeta
	cutoff := now.Add(-r.MaxAge)
	for _, it := range items {
		switch it.Status {
		case "completed", "failed", "partial":
		default:
			continue
		}
		if r.MaxAge > 0 && !it.UpdatedAt.After(cutoff) {
			drop = append(drop, it)
			continue
		}
		keep = append(keep, it)
	}
	sort.Slice(keep, func(i, j int) bool {
		if !keep[i].UpdatedAt.Equal(keep[j].UpdatedAt) {
			return keep[i].UpdatedAt.After(keep[j].UpdatedAt)
		}
		return keep[i].ID < keep[j].ID
	})
	if r.MaxCount > 0 && len(keep) > r.MaxCount {
		drop = append(drop, keep[r.MaxCount:]...)
	}
	sort.Slice(drop, func(i, j int) bool {
		if !drop[i].UpdatedAt.Equal(drop[j].UpdatedAt) {
			return drop[i].UpdatedAt.Before(drop[j].UpdatedAt)
		}
		return drop[i].ID < drop[j].ID
	})
	ids := make([]string, len(drop))
	for i, it := range drop {
		ids[i] = it.ID
	}
	return ids
}

func (p *Postgres) prune(ctx context.Context, now time.Time) error {
	if p.retention.MaxAge <= 0 && p.retention.MaxCount <= 0 {
		return nil
	}
	rows, err := p.db.QueryContext(ctx, "SELECT id, status, updated_at FROM astra_scans")
	if err != nil {
		return err
	}
	defer rows.Close()
	var items []scanMeta
	for rows.Next() {
		var it scanMeta
		if err = rows.Scan(&it.ID, &it.Status, &it.UpdatedAt); err != nil {
			return err
		}
		items = append(items, it)
	}
	if err = rows.Err(); err != nil {
		return err
	}
	ids := idsToDelete(items, now, p.retention)
	for _, id := range ids {
		if _, err = p.db.ExecContext(ctx, `DELETE FROM astra_scans WHERE id=$1 AND status IN ('completed','failed','partial')`, id); err != nil {
			return err
		}
	}
	return nil
}

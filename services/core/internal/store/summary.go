package store

import (
	"encoding/json"

	"github.com/astra-security/astra/services/core/internal/model"
)

func Summarize(s *model.Scan) model.ScanSummary {
	out := model.ScanSummary{
		ID: s.ID, Source: s.Source, Repository: s.Repository, Status: s.Status,
		CreatedAt: s.CreatedAt, UpdatedAt: s.UpdatedAt, Error: s.Error,
	}
	if len(s.Events) > 0 {
		last := s.Events[len(s.Events)-1]
		out.Stage = last.Stage
		out.Progress = last.Progress
		out.Message = last.Message
	}
	if len(s.Analysis) > 0 {
		var a struct {
			Summary json.RawMessage `json:"summary"`
		}
		if json.Unmarshal(s.Analysis, &a) == nil && len(a.Summary) > 0 {
			out.Summary = a.Summary
		}
	}
	return out
}

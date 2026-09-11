package scanner

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	gitinput "github.com/astra-security/astra/services/core/internal/git"
	"github.com/astra-security/astra/services/core/internal/model"
	"github.com/astra-security/astra/services/core/internal/registry"
	"github.com/astra-security/astra/services/core/internal/resolver"
	"github.com/astra-security/astra/services/core/internal/sandbox"
	"github.com/astra-security/astra/services/core/internal/store"
)

type Runner struct {
	Store        store.Store
	Registry     *registry.Client
	Intelligence *Intelligence
	Verifier     *sandbox.Client
}

func (r *Runner) Run(ctx context.Context, id string, input model.ScanInput) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	scan, err := r.Store.Get(ctx, id)
	if err != nil {
		slog.Error("scan_load_failed", "scan_id", id)
		return
	}
	persist := func() error {
		scan.UpdatedAt = time.Now().UTC()
		saveCtx, done := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer done()
		return r.Store.Save(saveCtx, scan)
	}
	emit := func(kind, stage, message string, progress int) error {
		scan.Events = append(scan.Events, model.Event{ID: len(scan.Events) + 1, Type: kind, Stage: stage, Progress: progress, Message: message, Time: time.Now().UTC()})
		slog.Info("scan_stage", "scan_id", id, "stage", stage, "progress", progress)
		return persist()
	}
	fail := func(err error) {
		scan.Status = "failed"
		scan.Error = err.Error()
		if e := emit("SCAN_FAILED", "failed", scan.Error, 0); e != nil {
			slog.Error("scan_persist_failed", "scan_id", id)
		}
	}
	scan.Status = "running"
	if err = emit("SCAN_STARTED", "repository_ingestion", "Reading repository inputs without running package scripts", 3); err != nil {
		fail(err)
		return
	}
	switch input.Source {
	case "github":
		fetchCtx, done := context.WithTimeout(ctx, 90*time.Second)
		input, err = gitinput.Fetch(fetchCtx, input)
		done()
		if err != nil {
			fail(err)
			return
		}
	case "demo":
		input = DemoInput(input.DeniedLicenses)
	}
	if err = emit("MANIFEST_PARSED", "ecosystem_detection", "npm package.json and package-lock.json detected", 10); err != nil {
		fail(err)
		return
	}
	graph, err := resolver.Parse(input.Manifest, input.Lockfile)
	if err != nil {
		fail(err)
		return
	}
	scan.Graph = graph
	if err = emit("DEPENDENCIES_DISCOVERED", "dependency_resolution", fmt.Sprintf("%d installed package instances resolved", len(graph.Packages)), 25); err != nil {
		fail(err)
		return
	}
	started := time.Now()
	if input.Source == "demo" {
		EnrichDemo(graph)
	} else {
		r.Registry.Enrich(ctx, graph)
	}
	slog.Info("scan_stage_complete", "scan_id", id, "stage", "metadata_enrichment", "duration_ms", time.Since(started).Milliseconds(), "packages", len(graph.Packages))
	if err = ctx.Err(); err != nil {
		fail(fmt.Errorf("scan time budget exceeded"))
		return
	}
	if err = emit("PACKAGE_ENRICHED", "metadata_enrichment", "Exact-version registry metadata and static lifecycle capabilities collected", 45); err != nil {
		fail(err)
		return
	}
	if err = emit("VULNERABILITY_MATCHED", "vulnerability_matching", "OSV matching completed; provider gaps are recorded as unknown", 55); err != nil {
		fail(err)
		return
	}
	if len(input.Sources) == 0 {
		graph.Warnings = append(graph.Warnings, "No source files supplied; import reachability remains unknown")
	}
	var reached model.Graph
	if err = r.Intelligence.Call(ctx, "/v1/reachability", map[string]any{"graph": graph, "sources": input.Sources}, &reached); err != nil {
		fail(err)
		return
	}
	*graph = reached
	input.Sources = nil
	scan.Manifest = append(json.RawMessage(nil), input.Manifest...)
	scan.Lockfile = append(json.RawMessage(nil), input.Lockfile...)
	if err = emit("GRAPH_UPDATED", "reachability_analysis", "AST module-reference evidence recorded; execution reachability remains unproven", 65); err != nil {
		fail(err)
		return
	}
	if err = emit("ANALYSIS_STARTED", "trust_mutation_detection", "Comparing installed-version maintainers and release cadence with registry history", 70); err != nil {
		fail(err)
		return
	}
	if err = emit("ANALYSIS_UPDATED", "license_analysis", "Applying the explicitly configured license deny policy", 75); err != nil {
		fail(err)
		return
	}
	if err = emit("ANALYSIS_UPDATED", "concentration_analysis", "Calculating maintainer concentration and reverse dependency centrality", 80); err != nil {
		fail(err)
		return
	}
	if err = r.Intelligence.Call(ctx, "/v1/analyze", map[string]any{"graph": graph, "denied_licenses": scan.DeniedLicenses}, &scan.Analysis); err != nil {
		fail(err)
		return
	}
	var analysis struct {
		Risks map[string]json.RawMessage `json:"risks"`
	}
	if err = json.Unmarshal(scan.Analysis, &analysis); err != nil {
		fail(err)
		return
	}
	for i := range graph.Packages {
		graph.Packages[i].Risk = analysis.Risks[graph.Packages[i].ID]
	}
	if err = emit("ANALYSIS_COMPLETED", "risk_aggregation", "Deterministic risk dimensions and evidence confidence calculated", 90); err != nil {
		fail(err)
		return
	}
	if err = emit("REMEDIATION_READY", "remediation_optimization", "Candidate changes available through the remediation endpoint", 95); err != nil {
		fail(err)
		return
	}
	if err = emit("EXPLANATION_READY", "explanation_generation", "Evidence interpreter ready; optional AI explanations are generated on request", 98); err != nil {
		fail(err)
		return
	}
	scan.Status = "completed"
	if len(graph.Warnings) > 0 {
		scan.Status = "partial"
	}
	if err = emit("SCAN_COMPLETED", "completed", "Dependency digital twin is ready", 100); err != nil {
		fail(err)
	}
}

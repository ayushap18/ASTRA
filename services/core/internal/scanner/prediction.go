package scanner

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/astra-security/astra/services/core/internal/model"
	"github.com/astra-security/astra/services/core/internal/resolver"
	"github.com/astra-security/astra/services/core/internal/sandbox"
)

type Predicted struct {
	Plan     json.RawMessage
	Manifest []byte
	Lockfile []byte
	Graph    *model.Graph
}

func note(plan map[string]any, line string) {
	limits, _ := plan["limitations"].([]any)
	for _, item := range limits {
		if item == line {
			return
		}
	}
	plan["limitations"] = append(limits, line)
}

func (r *Runner) AttachPrediction(ctx context.Context, scan *model.Scan, raw json.RawMessage) (json.RawMessage, error) {
	predicted, err := r.Predict(ctx, scan, raw)
	if err != nil {
		return nil, err
	}
	return predicted.Plan, nil
}

func (r *Runner) Predict(ctx context.Context, scan *model.Scan, raw json.RawMessage) (Predicted, error) {
	var plan map[string]any
	if err := json.Unmarshal(raw, &plan); err != nil {
		return Predicted{}, err
	}
	plan["verified"] = false
	plan["predicted_risk"] = nil
	changes, _ := plan["changes"].([]any)
	for _, change := range changes {
		if item, ok := change.(map[string]any); ok {
			item["verified"] = false
		}
	}
	finish := func() (Predicted, error) {
		body, err := json.Marshal(plan)
		return Predicted{Plan: body}, err
	}
	if len(scan.Manifest) == 0 || len(scan.Lockfile) == 0 {
		note(plan, "Scan snapshot has no lockfile; predicted risk stays null.")
		return finish()
	}
	byID := map[string]model.Package{}
	if scan.Graph != nil {
		for _, p := range scan.Graph.Packages {
			byID[p.ID] = p
		}
	}
	var upgrades []resolver.DirectUpgrade
	for _, change := range changes {
		item, ok := change.(map[string]any)
		if !ok {
			continue
		}
		if item["action"] != "upgrade_direct_dependency" {
			continue
		}
		id, _ := item["package_id"].(string)
		pkg, ok := byID[id]
		if !ok || !pkg.Direct {
			note(plan, "Direct upgrade "+id+" is missing from the stored graph.")
			return finish()
		}
		from, _ := item["from"].(string)
		to, _ := item["to"].(string)
		upgrades = append(upgrades, resolver.DirectUpgrade{Name: pkg.Name, From: from, To: to, InstallPath: pkg.InstallPath})
	}
	if len(upgrades) == 0 {
		note(plan, "No direct dependency upgrades to re-resolve.")
		return finish()
	}
	if scan.Source != "demo" {
		if err := r.directUpgradesCompatible(ctx, scan.Lockfile, upgrades); err != nil {
			note(plan, err.Error())
			return finish()
		}
	}
	manifest, lockfile, err := resolver.ApplyDirectUpgrades(scan.Manifest, scan.Lockfile, upgrades)
	if err != nil {
		note(plan, "Could not apply direct upgrades: "+err.Error())
		return finish()
	}
	graph, err := resolver.Parse(manifest, lockfile)
	if err != nil {
		note(plan, "Bumped lockfile did not resolve: "+err.Error())
		return finish()
	}
	if scan.Source == "demo" {
		EnrichDemo(graph)
	} else {
		r.Registry.Enrich(ctx, graph)
	}
	var analysis map[string]any
	if err = r.Intelligence.Call(ctx, "/v1/analyze", map[string]any{"graph": graph, "denied_licenses": scan.DeniedLicenses}, &analysis); err != nil {
		return Predicted{}, err
	}
	summary, _ := analysis["summary"].(map[string]any)
	plan["predicted_risk"] = summary["risk"]
	note(plan, "Predicted risk re-analyzes a bumped lockfile without source, tests, or builds.")
	plan["verification_required"] = []any{
		"Run application tests and build in an isolated environment.",
		"Confirm the predicted graph against a lockfile regenerated with npm --ignore-scripts.",
	}
	body, err := json.Marshal(plan)
	return Predicted{Plan: body, Manifest: manifest, Lockfile: lockfile, Graph: graph}, err
}

func coverageComplete(graph *model.Graph) bool {
	if graph == nil {
		return false
	}
	for _, p := range graph.Packages {
		osv, reg := p.Metadata.OSVStatus, p.Metadata.RegistryStatus
		if osv != "available" && osv != "fixture" {
			return false
		}
		if reg != "available" && reg != "fixture" {
			return false
		}
	}
	return true
}

func (r *Runner) AttachVerification(ctx context.Context, scan *model.Scan, proposal json.RawMessage, zip []byte) (json.RawMessage, error) {
	predicted, err := r.Predict(ctx, scan, proposal)
	if err != nil {
		return nil, err
	}
	var plan map[string]any
	if err = json.Unmarshal(predicted.Plan, &plan); err != nil {
		return nil, err
	}
	markUnverified := func(line string) (json.RawMessage, error) {
		note(plan, line)
		plan["verified"] = false
		changes, _ := plan["changes"].([]any)
		for _, change := range changes {
			if item, ok := change.(map[string]any); ok {
				item["verified"] = false
			}
		}
		return json.Marshal(plan)
	}
	if scan.Source == "demo" {
		return markUnverified("Demo fixture packages are synthetic and cannot be build-verified.")
	}
	if predicted.Graph == nil || plan["predicted_risk"] == nil {
		return markUnverified("Predicted graph is incomplete; verified stays false.")
	}
	if !coverageComplete(predicted.Graph) {
		return markUnverified("Registry or OSV coverage is incomplete; verified stays false.")
	}
	if r.Verifier == nil {
		return markUnverified("Verifier is not configured; remediation stays unverified.")
	}
	out, err := r.Verifier.Verify(ctx, sandbox.Request{
		Zip:              zip,
		OriginalLockfile: scan.Lockfile,
		OriginalManifest: scan.Manifest,
		BumpedManifest:   predicted.Manifest,
		BumpedLockfile:   predicted.Lockfile,
	})
	if err != nil {
		return nil, err
	}
	plan["verification"] = out
	for _, line := range out.Limitations {
		note(plan, line)
	}
	if !out.Passed || !out.InstallOK {
		return markUnverified("Isolated install or declared scripts did not pass.")
	}
	plan["verified"] = true
	changes, _ := plan["changes"].([]any)
	for _, change := range changes {
		if item, ok := change.(map[string]any); ok {
			item["verified"] = true
		}
	}
	note(plan, "verified:true means this changeset passed npm ci --ignore-scripts and declared test/build in an isolated container, not that the patch is safe.")
	return json.Marshal(plan)
}

func (r *Runner) directUpgradesCompatible(ctx context.Context, lockfile []byte, upgrades []resolver.DirectUpgrade) error {
	var parsed struct {
		Packages map[string]struct {
			Dependencies map[string]string `json:"dependencies"`
		} `json:"packages"`
	}
	if err := json.Unmarshal(lockfile, &parsed); err != nil {
		return fmt.Errorf("stored lockfile is not usable for prediction")
	}
	for _, upgrade := range upgrades {
		current := parsed.Packages[upgrade.InstallPath].Dependencies
		have := map[string]bool{}
		for name := range current {
			have[name] = true
		}
		deps, err := r.Registry.VersionDependencies(ctx, upgrade.Name, upgrade.To)
		if err != nil {
			return fmt.Errorf("Registry metadata unavailable for %s@%s; predicted risk stays null.", upgrade.Name, upgrade.To)
		}
		for name := range deps {
			if !have[name] {
				return fmt.Errorf("%s@%s would add dependency %s; regenerate the lockfile. Predicted risk stays null.", upgrade.Name, upgrade.To, name)
			}
		}
	}
	return nil
}

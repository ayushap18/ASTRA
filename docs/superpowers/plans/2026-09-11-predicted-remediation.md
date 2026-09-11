# Predicted Remediation Implementation Plan

> Execute in this session. No Git repository is present.

**Goal:** Persist lockfile/manifest, re-parse compatible direct upgrades, set `predicted_risk`, never set `verified: true`.

**Architecture:** Resolver mutates a lockfile copy. Scanner re-enriches and re-analyzes. API strips inputs from public scan JSON. Python optimizer stays a proposal engine.

## Tasks

1. Resolver `ApplyDirectUpgrades` + tests (exact pin bump, range preserved, missing instance error).
2. Persist inputs on `Scan`; strip on GET; stop nilling after reachability; EnrichDemo skips fixed versions.
3. `AttachPrediction` after `/v1/remediation`; tests for demo risk number and missing-lockfile null.
4. Docs + Remediate UI copy; smoke asserts `predicted_risk` is a number and `verified` is false.

# Predicted remediation (no verified patches)

## Goal

After a greedy remediation proposal, re-parse a bumped copy of the stored lockfile and re-analyze it so `predicted_risk` can be a number. `verified` stays false. No npm, lifecycle scripts, tests, or builds.

## Persistence

Completed scans retain `package.json` and `package-lock.json` on the snapshot. Source files and GitHub tokens stay dropped. Public `GET /api/v1/scans/{id}` omits stored lockfile and manifest.

## Prediction

1. Python still returns the greedy proposal with `verified: false` and `predicted_risk: null`.
2. Core applies only `upgrade_direct_dependency` changes to a copy of the stored files:
   - bump the matching lockfile instance `version`;
   - if the root declaration is an exact `from` version, bump that pin in both files;
   - leave ranges unchanged.
3. Compatibility without npm: a live new version’s declared dependency *names* must already be children of that lockfile instance. Demo assumes unchanged names. If the tree would change, skip prediction and record that a lockfile regenerate is required.
4. Re-run `resolver.Parse`, then demo or registry/OSV enrichment, then `/v1/analyze` with no sources. Reachability on the predicted graph is unknown.
5. Set `predicted_risk` to the new summary risk. Keep `verified: false`. Demo advisories attach only when the installed version is not listed in `fixed_versions`.

## Non-goals

`verified: true`, npm CLI, project scripts, sandbox builds, invented migration time, blind transitive overrides.

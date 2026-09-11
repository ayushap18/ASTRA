# Isolated remediation verification sandbox

## Goal

Set `verified: true` only after a dedicated verifier installs the bumped lockfile without lifecycle scripts and the project’s declared `test`/`build` scripts pass in a network-disabled container. This is evidence that those checks passed for this changeset. It is not a safety, exploitability, or production-readiness claim.

## Trust boundary

- Core never receives a Docker socket and never executes analyzed project commands.
- The verifier is a separate process (`astra-verifier`). It is the privileged boundary: it may talk to a Docker engine.
- Core calls the verifier with `ASTRA_INTERNAL_TOKEN`. If `ASTRA_VERIFIER_URL` is unset or the verifier is unavailable, remediation stays `verified: false`.
- Demo scans cannot be verified: fixture packages are synthetic.

## Operator input

`POST /api/v1/scans/{id}/verify` is `multipart/form-data`:

- `max_changes` (1–100)
- `project` (ZIP)

The ZIP is used once and deleted. It is not stored on the scan snapshot. Public APIs never return ZIP bytes.

The ZIP must contain root `package.json` and `package-lock.json` whose bytes match the stored scan lockfile and whose package name matches the stored manifest. Traversal, absolute paths, symlinks, `node_modules`, and oversized archives are rejected.

## Execution

1. Compute the same greedy proposal and compatible direct upgrades as predicted remediation.
2. Write the bumped manifest/lockfile into the unpacked tree.
3. **Install phase** (network allowed, scripts forbidden): `npm ci --ignore-scripts` as non-root, dropped capabilities, memory/CPU/PID/time limits, read-only root plus a work tmpfs/volume.
4. **Execute phase** (`--network=none`): run `test` if declared and `build` if declared. At least one must exist. Every selected script must exit 0.
5. Re-parse the bumped lockfile, re-enrich, re-analyze without sources.
6. `verified: true` only if install and selected scripts succeeded, registry/OSV status is not `unavailable` on any package, and `predicted_risk` was produced. Otherwise `verified: false` with limitations.

Captured evidence is exit codes, durations, and SHA-256 of stdout/stderr—not raw logs or source.

## Non-goals

Mounting Docker into core, Kubernetes, arbitrary script names, `npm install` without a lockfile, running lifecycle scripts, claiming the patch is safe, verifying the demo fixture.

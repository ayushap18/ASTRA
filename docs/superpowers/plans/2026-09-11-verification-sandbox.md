# Verification sandbox implementation plan

**Goal:** Dedicated verifier + core `POST .../verify` + Remediate ZIP upload. `verified: true` only after isolated npm ci (ignore-scripts) and declared test/build.

**Stack:** Same Go module as core. `internal/sandbox` + `cmd/astra-verifier`. Docker CLI at verify time. Tests fake Docker.

## Tasks

1. ZIP unpack + script selection tests, then implementation.
2. Verifier HTTP + Docker runner with injectable command.
3. Core client, `/verify` route, refuse demo, attach verified only when checks pass.
4. Compose verifier service (docker.sock on verifier only), docs, Remediate UI, smoke still passes without verifier.

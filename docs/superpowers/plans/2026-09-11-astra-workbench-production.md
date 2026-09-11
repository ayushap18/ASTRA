# Astra sequential production backlog

> Execute **one task per confirmation**. After each task: report workflow, files changed, verification, then stop and wait.

**Goal:** Operator-grade workbench (Figma modes, shared `package`/`finding`, Postgres, Compose including web) without tenant SaaS or Codecurrent clones.

**Already shipped:** Task 1 (workbench URL, ancestry blast, JSON export).

---

## How we proceed

| # | Task | Confirm before | Depends on |
| --- | --- | --- | --- |
| 1 | Workbench URL + blast + export | done | UI |
| 2 | Compose `web` image on loopback `:3000` | done | Task 1 |
| 3 | Operator runbook (Postgres vs memory) | done | Task 2 |
| 4 | Snapshot retention/prune | done | Postgres |
| 5 | AST reachability (level 2; execution still unproven) | done | intelligence |
| 6 | Compatible lockfile re-parse + predicted_risk | done | 4–5 |

**Out of scope:** OAuth, Redis, scan list API, dark mode, Codecurrent file graphs.

---

### Task 1 — Workbench connection (done)

Workflow: operator selects a finding → URL holds instance `id` → Graph/Attack/Remediate keep focus → Graph paints install ancestors on cream → export JSON without sources.

Changed: `lib/investigation.ts`, tests, `mode-nav`, `finding-list`, `graph-canvas`, `workbench-export`, scan pages, `design.md`, `PLAN.md`.

Verified: demo scan in browser; Graph kept `package`+`finding`; ancestor caption; web unit tests pass.

---

### Task 2 — Compose includes the workbench (done)

**Produces:** `infra/docker/web.Dockerfile`, Compose `web` on `127.0.0.1:3000`, `ASTRA_CORE_URL=http://core:8080`, token only in env.

Verified: Colima + `docker compose --env-file .env -f infra/compose.yaml up --build`; Home and a demo scan on `http://127.0.0.1:3000`. Compose tmpfs options are size-only (Docker 29 rejects comma `noexec`).

---

### Task 3 — Operator runbook (done)

**Files:** `README.md`, `docs/architecture.md`, `apps/web/README.md`

Production = `DATABASE_URL` + Compose (postgres+intelligence+core+web). Memory store = laptop only. Interrupted `queued`/`running` scans fail on restart; resubmit. Compose workbench `http://127.0.0.1:3000`. GitHub stays off by default.

---

### Task 4 — Snapshot retention (done)

**Files:** `services/core/internal/store/`, Go tests, operator docs, Compose env.

Prune `completed`/`failed`/`partial`. Never delete `queued`/`running`. Defaults: `ASTRA_SCAN_RETENTION_AGE=720h`, `ASTRA_SCAN_RETENTION_COUNT=500`. `0` disables that limit.

---

### Task 5 — Stronger reachability (done)

**Files:** `services/intelligence/app/reachability/`, focused tests, locked Tree-sitter dependencies, analysis/API docs

Tree-sitter JavaScript/TypeScript module observations + evidence hashes. Level 2 means parsed module syntax only. Levels 3–4 and edge reachability remain reserved; never claim “runs in production”.

---

### Task 6 — Predicted remediation (done)

Persist lockfile/manifest (not source). Re-parse compatible direct upgrades. Set `predicted_risk` from re-analysis. `verified` stays false (no project tests/builds, no npm).

---

### Task 7 — Isolated verification sandbox (done)

Dedicated `astra-verifier`. ZIP at verify time, never stored. `npm ci --ignore-scripts` then declared test/build in limited containers. Docker socket on verifier only. `verified: true` only after those gates; not a safety claim. Demo cannot verify.

---

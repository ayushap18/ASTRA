# Operator dashboard implementation plan

> Agents: implement in order. After each slice run the commands in that slice. Do not claim done without `make test`, `make lint`, and `make build`.

**Goal:** Multi-scan operator dashboard plus `GET /api/v1/scans`, with checks agents can run.

**Architecture:** Go `Store.List` + public list resource. Next.js App Router shell polls that list. Investigation routes stay under `/scans/[id]`.

**Tech stack:** Go 1.26, Next 15, existing CSS tokens rewritten in `globals.css`.

## Global constraints

- Token never in the browser. Unknown ≠ 0. `verified: true` is not “safe”. Graph node key is instance `id`. Magenta = Sarvam only.

### Task 1: Store.List + GET /api/v1/scans

- Test: memory list order, status filter, limit, summary omits lockfile.
- Implement `model.ScanSummary`, `store.List`, `api.list`.
- Smoke: list contains demo id and no `lockfileVersion`.

### Task 2: Dashboard shell + visual system

- Rewrite `apps/web/design.md` and `globals.css`.
- `AppShell` with scan list, live rail, + Scan.
- Home = queue form + scan table.
- Scan layout uses the shell (no second top nav).

### Task 3: Investigation honesty + modes

- Donuts unknown; partial banner; `?package=` finding select.
- Attack/remediate results on canvas.
- SSE reconnect on the investigation rail.

### Task 4: Tooling agents can run

- ESLint non-interactive, `tsc` exclude tests, `"type": "module"`.
- Makefile `test`/`lint`/`build` include `apps/web`.
- CI: Node + `make setup test lint`.

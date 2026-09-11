# Operator dashboard (multi-scan console)

## Goal

Replace the editorial one-block-per-page workbench with a persistent operator dashboard. An operator can queue multiple npm scans, see them live, and open one scan’s investigation modes. `verified: true` remains isolated-check evidence, not a safety claim.

## Backend

`Store.List(ctx, limit, status) ([]model.ScanSummary, error)`.

`GET /api/v1/scans?limit=&status=` returns `{ "scans": [ScanSummary...] }` newest first. Default `limit` 50, max 200. `status` is empty (all) or one of `queued|running|completed|partial|failed`.

A summary is `id`, `source`, `repository`, `status`, `created_at`, `updated_at`, `error`, analysis `summary` numbers when present, and the latest event `stage`/`progress`/`message`. No graph, manifest, lockfile, events array, or source.

Queue stays 18 slots / 2 workers. `429 queue_full` stays. Public GET still strips lockfile/manifest.

## Dashboard UI

Persistent graphite chrome (`#181c22` / `#232935`), paper canvas `#f6f7f8`, ink `#14161a`. Pastels are mode accents and chart series only. Magenta is only Sarvam. JetBrains Mono is for IDs, hashes, and large metric numerals. Inter is UI type.

Shell: left scan list + mode nav; top status (core ready, running/queued counts, + Scan); live rail of non-terminal scans (poll the list endpoint). Home is the dashboard (queue a scan + table of scans). `/scans/[id]/…` keeps Overview, Graph, Attack, Timeline, Remediate.

Unknown metrics render as `unknown`, never `0`. `partial` shows warnings on Overview. `?package=` selects a finding for that instance. Attack/remediate results sit on the paper canvas, not inside the accent panel. Core down is 503, missing scan is 404.

## Agent checks

`make test`, `make lint`, and `make build` cover Go, Python, and `apps/web` (unit tests, ESLint, `tsc`, Next build). CI runs the same. Demo smoke asserts the list endpoint omits lockfiles.

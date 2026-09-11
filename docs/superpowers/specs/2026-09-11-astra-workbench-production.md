# Astra workbench and operator production

Date: 2026-09-11  
Audience: one trusted operator. Not a public “paste any GitHub URL” architecture linter.

## Problem

The investigation UI already has five modes (Overview, Graph, Attack, Timeline, Remediate) in the Figma workbench chrome. They did not share a selected install instance, so an operator had to re-pick a package after every mode change. Codecurrent-style whole-repo AST, health grades, and regex “security findings” are out of scope: they would lie about evidence Astra does not have.

## Product

Astra is a **dependency digital twin workbench**. The operator starts a scan on Home, then investigates one scan as a desk of pastel blocks. Shared URL state is the workbench clamp:

```text
/scans/{id}?package={instance id}&finding={finding id}
```

Mode pills keep that query. Graph highlights **install ancestors** (who depends on this instance). Copy must say ancestry is not execution. Attack already accepts `?package=`. Export is stored evidence only (no source bodies, no tokens).

Visual system stays `apps/web/design.md`: white chrome, one color block per mode, pill CTAs, magenta only for optional Sarvam Explain.

## Necessary workbench features (UI)

| Feature | Status | Rule |
| --- | --- | --- |
| Shared `package` / `finding` query | implemented | Never put API tokens in the URL |
| Mode nav preserves query | implemented | |
| Finding → Graph / Attack | implemented | Uses `package_id` = graph `id` |
| Install-ancestor blast | implemented | Caption: not an execution path |
| Evidence-linked JSON export | implemented | Findings, evidence IDs, warnings, limitations |
| Timeline as this-scan SSE log | already shipped | Not maintainer history |
| Remediate as proposal | already shipped | `verified: false` |

Do not add: dark SOC theme, A–F health, browser GitHub App JWT, fake reviewers, Codecurrent regex vulns as Astra findings, scan list without a core list API.

## Operator production (what “production” means here)

This product is a **single-operator service** (`ASTRA_API_TOKEN`). Production for that class is:

1. PostgreSQL snapshots (`DATABASE_URL`), not the memory store.
2. Next.js workbench deployed with the same-origin `/api/v1` proxy; token only in server env.
3. Compose (or equivalent) runs postgres + intelligence + core + web on loopback (`http://127.0.0.1:3000`).
4. GitHub ingestion stays off until isolation/egress policy exists (`ASTRA_ENABLE_GITHUB`).
5. Demo fixture labeled synthetic.
6. Health/ready/metrics already on core; workbench already shows Ready/Degraded.

It is **not** yet: multi-tenant SaaS, OAuth, scan history index, Redis workers, verified patches, private untrusted GitHub, or calibrated risk probabilities.

## Backend increments (still required for a serious operator)

From README / architecture, in order:

1. Persist enough to resume interrupted scans or require explicit resubmit UX (today unfinished scans fail on restart because inputs are not stored).
2. Retention/pruning for PostgreSQL JSONB snapshots.
3. AST/tree-sitter import resolution before claiming stronger reachability (levels 2–4).
4. Historical registry snapshots before Timeline is a trust timeline.
5. Isolated project tests/builds before Remediate can set `verified: true`. Compatible lockfile re-parse may set `predicted_risk` only.
6. Per-scan worker isolation and egress allowlist before exposing GitHub to anyone but a trusted operator.
7. Optional `GET /scans` only if a list UI is required; do not fake a history table in the client.

## Honesty constraints

- Unknown ≠ safe.
- Provider failure ≠ empty vulnerability list.
- `id` is install instance; never collapse by name/purl.
- AI commentary cannot change scores.
- No invented blast-radius “execution” from dependency edges.

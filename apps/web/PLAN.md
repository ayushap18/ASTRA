# Astra investigation UI — product plan

**Audience:** one trusted operator.  
**Job of Home:** start a scan without lying about coverage.  
**Job of a scan:** investigate evidence — not a marketing dashboard, not a red/green security scorecard.

This is the production-grade frontend plan. Tokens live in `design.md`. Implementation slices live in `../../docs/superpowers/plans/2026-09-11-astra-investigation-ui.md`.

---

## 1. Design thesis

Astra’s chrome is editorial paper: **white canvas, black ink, 56px nav, pill CTAs**. Investigation happens on **one pastel field at a time** — lime, cream, coral, lilac, mint, pink, navy — like a desk of oversized notes. Color is the section. Type weight is hierarchy. Mono is taxonomy. Shadows do not decorate color blocks.

That is the system. A “dark SOC dashboard” would be a different product. Do not switch palettes mid-build.

**Signature moment:** the black **process rail** under the nav. It is the only animation that must always be honest: width tracks SSE `progress`, steps light only after that stage event exists. Fake spinners that finish before the API are forbidden.

---

## 2. Color control (every token used on purpose)

| Token | Hex | Role in the product |
| --- | --- | --- |
| `--primary` / `--ink` | `#000000` | Headlines, body, primary pill, selected tab, bar fills |
| `--on-primary` / `--canvas` | `#ffffff` | Page, secondary pill fill, inverse type |
| `--inverse-canvas` | `#000000` | Process rail, marquee |
| `--inverse-ink` | `#ffffff` | Type on the rail |
| `--hairline` | `#e6e6e6` | Inputs, graph canvas edge, donut track |
| `--hairline-soft` | `#f1f1f1` | Finding row rules |
| `--surface-soft` | `#f7f7f5` | Skeleton blocks, icon buttons, empty tiles |
| `--block-lime` | `#dceeb1` | Home intake + Overview |
| `--block-cream` | `#f4ecd6` | Graph |
| `--block-coral` | `#f3c9b6` | Attack |
| `--block-lilac` | `#c5b0f4` | Timeline |
| `--block-mint` | `#c8e6cd` | Remediate |
| `--block-pink` | `#efd4d4` | Evidence / findings strip |
| `--block-navy` | `#1f1d3d` | Failed scan, 409/502 callouts |
| `--accent-magenta` | `#ff3d8b` | **One** Explain control per page when `use_ai` |
| `--semantic-success` | `#1ea64a` | Check glyph only (ready), never a “safe” package fill |

No mid-gray body. No extra red/orange severity palette. Severity is a **caption** (`critical`, `unknown`) plus type weight.

---

## 3. Chrome and buttons (Home tab done properly)

**Top nav (56px, white, sticky):**

```
[ Astra ]     [ Home ]  [ New scan ]
```

- `Home` is a tertiary text control (`button-tertiary-text` / link pill hit target). Current route `/` sets `aria-current="page"`.
- **One** primary pill in the nav: `New scan` → `/#scan` on Home, `/` from a scan.
- Never two black pills in the same viewport.

**Buttons (only these):**

| Component | Use |
| --- | --- |
| `button-primary` | Start scan, Simulate, Request proposal, Explain with AI |
| `button-secondary` | Use demo, Contact-style cancel, “Without AI” |
| `button-magenta-promo` | Explain with Sarvam — once |
| Source tabs | Same as pricing tabs: unselected white, selected black |

Disabled = 40% opacity, `cursor: not-allowed`, min-height 44px. Focus = 2px black ring, 2px offset.

---

## 4. System design (how the UI meets the backend)

```
Browser ──same-origin──► Next /api/v1/* ──Bearer ASTRA_API_TOKEN──► Core :8080
                              │
                              └── never in JS bundles or query strings
```

| Backend fact | UI consequence |
| --- | --- |
| `GET /scans` list + `GET /status` | Home is a widget dashboard: process cards, queue slots, API usage, scans manager. |
| `POST` 202 + `scan_id` | Immediate route to `/scans/{id}`; do not wait for completion. |
| SSE + `Last-Event-ID` | Process rail; `fetch` stream, not `EventSource`. |
| States `queued\|running\|completed\|partial\|failed` | Skeletons until graph/findings exist; partial still shows warnings. |
| Graph `id` ≠ `purl` | Graph nodes and simulate/explain use `id`. |
| `github_token` ephemeral | Password field; cleared after POST; never logged. |
| ZIP is client unpack → `lockfile` | No core `source: zip`. |
| Remediation `verified: false` | Copy and chrome must say proposal. |
| Timeline history does not exist | Lilac empty state, not a fake chart. |
| `GET /ready` | Quiet caption in nav: Ready / Degraded. Do not block Home. |

**Errors:** `{ error: { code, message } }` plus `X-Request-ID`. Toast/inline: the **message**, caption the **code** and request id. Map 401 (token), 403 (GitHub off), 409 (not ready), 429 (queue), 502 (intelligence).

---

## 5. Motion

Allowed: process-rail width; bar `scaleX`; step opacity; skeleton pulse on `--surface-soft`.  
`prefers-reduced-motion`: pulse and width transitions off; final state still correct.  
Forbidden: confetti, graph orbit, counting-up scores, skeleton that resolves on a timer instead of data.

---

## 6. Loading, skeletons, empty, error

| Situation | Surface |
| --- | --- |
| Route pending (`loading.tsx`) | Same layout chrome; color block filled with 3–5 `surface-soft` rounded bars (8px), pulse |
| Scan `queued` / `running` | Rail animates; Overview donuts as hollow tracks; findings list skeletons; Graph “topology not ready” |
| `409` graph/findings | Cream/lime block stays; body: “Wait for analysis.” |
| Failed | Navy block, `scan.error`, primary “New scan” |
| Empty findings after complete | “No findings were recorded.” |
| Core down | Home form error from proxy; scan layout `not-found` / error boundary |
| ZIP parse fail | Inline error on Home, stay on form |

Files to add: `app/loading.tsx`, `app/error.tsx`, `app/scans/[id]/loading.tsx`, `components/ui/skeleton.tsx`.

---

## 7. Page-by-page

### Home `/`

White hero → widget grid → lime intake (`#scan`). The grid (`components/dashboard.tsx`, helpers in `lib/dashboard.ts`) polls `GET /api/v1/status` every 5 s and `GET /api/v1/scans` every 2.5 s: System dots, Queue slot cells, one process card per in-flight scan with an honest progress bar and elapsed clock, Risk snapshot bars, Quick actions (queue demo), API usage counters (in-memory since core start), and a full-width Scans manager with status pills, id/repository search, Open / Re-run / Copy ID. Re-run is only offered when core still has the inputs (demo, GitHub); lockfile rows say so. No cancel or delete until core has an API for it. Unknown is rendered as `unknown`, never 0 or a fake ok. The form keeps its tabs (demo / GitHub / ZIP / lockfile), one Start scan, and secondary “Use demo” only when tab ≠ demo.

### Scan shell `/scans/[id]/*`

Nav + process rail + mode pills: Overview, Graph, Attack, Timeline, Remediate.  
`aria-current` on the mode. Failed scans still allow Graph if a partial graph exists.

### Overview `/scans/[id]`

Lime field: trust / risk / confidence donuts, mean-dimension radar, bars (severity, kind, depth). White below: findings.  
**Add:** pink evidence strip for the selected finding’s `evidence_ids` (GET `/evidence` or graph.evidence). Magenta Explain on the selected **package instance** only.

### Graph `/scans/[id]/graph`

Cream + XYFlow. Custom node: name@version, caption depth/direct. Click node → inspect drawer (`id`, `purl`, risk). Edges skip missing endpoints (already). Root edges omitted until a root node exists — do not invent a fake root package.

### Attack `/scans/[id]/attack`

Coral form (instance select, CI, lifecycle, categories). Results on **white** under the block: ATR number, limitations, propagation list. Empty categories allowed.

### Timeline `/scans/[id]/timeline`

Lilac. Headline: history unavailable. No sparkline of fake ownership. Optional: list **this scan’s SSE events** as a caption log (that is scan history, not maintainer history). Label it “This scan”, not “Trust timeline”.

### Remediate `/scans/[id]/remediate`

Mint form (`max_changes` 1–100). Results: `status proposal`, `verified false`, predicted risk `null`, remaining IDs, verification_required. Never a green “fixed” badge.

### Not found

White: “This scan is not in storage.” Memory mode note. Primary Home.

---

## 8. File control (target layout)

```text
apps/web/
  PLAN.md                 this document
  design.md               tokens + constraints
  app/globals.css         tokens + layout + skeletons
  app/layout.tsx          fonts
  app/loading.tsx         home skeleton
  app/error.tsx           proxy/core failure
  app/page.tsx            home
  app/scans/[id]/layout.tsx
  app/scans/[id]/loading.tsx
  app/scans/[id]/page.tsx
  app/scans/[id]/graph|attack|timeline|remediate/page.tsx
  components/ui/button.tsx
  components/ui/top-nav.tsx      Home + New scan
  components/ui/skeleton.tsx
  components/scan-form.tsx
  components/scan-progress.tsx
  components/mode-nav.tsx
  components/charts.tsx
  components/graph-canvas.tsx
  components/attack-form.tsx
  components/remediate-form.tsx
  components/explain-control.tsx
  components/evidence-strip.tsx
  components/workbench-export.tsx
  lib/core.ts lib/server.ts lib/types.ts
  lib/payloads.ts lib/zip-ingest.ts lib/graph-layout.ts lib/investigation.ts
```

Do not add shadcn, Zustand, or TanStack Query until a second cache consumer exists. Fetch + SSE is enough.

---

**Ships today:** Home editorial intake desk (demo/github/zip/lockfile) + source story taxonomy; TopNav 56px with ready/degraded status badge; Footer with structured architecture columns; SSE honest process rail; Overview charts; pink evidence strip; Explain with AI magenta control; XYFlow custom package node cards & instance inspector; Attack compromise simulation; Timeline scan history; Remediate candidate proposals; Figma pill CTAs; tokenized CSS classes; workbench query (`package`, `finding`) shared across modes; install-ancestor blast on Graph; evidence-linked JSON export.

**Build status:** Investigation chrome is in place. That is not multi-tenant production. Next: operator production (Compose web, Postgres-backed durability, GitHub isolation) then backend increments in README. Spec: `docs/superpowers/specs/2026-09-11-astra-workbench-production.md`. Plan: `docs/superpowers/plans/2026-09-11-astra-workbench-production.md`.

---

## 10. Ideas that are out of scope

Multi-tenant login, scan history UI, dark mode, verified-patch green path, executing npm in the browser, putting PATs in git URLs, extra accent colors, Redis, listing all scans without a core API.

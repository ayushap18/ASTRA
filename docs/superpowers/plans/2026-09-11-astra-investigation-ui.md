# Astra investigation UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise the existing Next.js investigation client to production chrome — Home tab, shared pills, skeletons, evidence/explain, graph inspector — without inventing backend capabilities.

**Architecture:** Same-origin Next proxy to Go core. Server Components load scan/graph/findings; client forms and SSE rail. Color-block mapping and copy rules in `apps/web/design.md` and `apps/web/PLAN.md`.

**Tech Stack:** Next.js App Router, TypeScript, Inter + JetBrains Mono, CSS tokens, XYFlow, fflate (ZIP only).

## Global Constraints

- Follow `apps/web/design.md` and `apps/web/PLAN.md` (Figma editorial frame; Inter/JetBrains Mono).
- Pills only; one `button-primary` per viewport; magenta only for Sarvam Explain.
- Tokens never in browser bundles or query strings; proxy attaches `ASTRA_API_TOKEN`.
- Package `id` is the instance key; `purl` is version identity.
- Remediation stays `verified: false`; timeline history stays unavailable.
- Unknown is unknown; no mid-gray body; no extra red/orange severity palette.
- Do not add scan list, Redis, tenants, dark mode, or execute analyzed scripts.
- ZIP remains client unpack → `source: "lockfile"`. GitHub PAT is `github_token` only.

## File map

- Modify: `apps/web/components/ui/button.tsx`, `top-nav.tsx`, `app/globals.css`, `app/page.tsx`, `app/scans/[id]/**`, `components/scan-progress.tsx`, `components/graph-canvas.tsx`
- Create: `app/loading.tsx`, `app/error.tsx`, `app/scans/[id]/loading.tsx`, `components/ui/skeleton.tsx`, `components/explain-control.tsx`, `components/evidence-strip.tsx`

---

### Task 1: Chrome — Home tab and shared pills

**Files:** `components/ui/top-nav.tsx`, `components/ui/button.tsx`, `app/globals.css`, `app/page.tsx`

**Produces:** Nav `Home` (`aria-current` on `/`) + single primary `New scan`; buttons use CSS classes `.pill.primary|.secondary|.magenta` not inline duplicates.

- [x] Add Home link; keep one black pill.
- [x] Optional: `GET /api/v1` proxy of `/ready` → caption Ready/Degraded (no token leak).
- [x] Verify Home in the browser: tab current, Start scan still the only primary in the lime block.

### Task 2: Skeletons and error boundaries

**Files:** `components/ui/skeleton.tsx`, `app/loading.tsx`, `app/scans/[id]/loading.tsx`, `app/error.tsx`, `app/scans/[id]/error.tsx`

**Produces:** Pulse bars on `--surface-soft`; reduced-motion disables pulse; errors show API `message` + `X-Request-ID` when present.

- [x] Scan loading matches lime/cream block shape, not a spinner-only page.
- [x] Trigger a missing scan id → not-found copy unchanged.

### Task 3: Overview evidence strip (pink)

**Files:** `components/evidence-strip.tsx`, `app/scans/[id]/page.tsx`, `lib/server.ts`

**Produces:** Selecting a finding shows evidence IDs/summaries on `--block-pink`. White canvas between lime and pink.

- [x] Data from graph evidence or `GET .../evidence`.
- [x] No evidence body sent to Sarvam later.

### Task 4: Explain control (magenta, once)

**Files:** `components/explain-control.tsx`, Overview or Attack inspector

**Produces:** `POST .../explain` with `package_id`, `use_ai`, `language`. Default without AI. Magenta only when `use_ai`. Label `ai_generated`. Fallback warnings visible.

- [x] Do not show magenta if `use_ai` is false.

### Task 5: Graph inspector

**Files:** `components/graph-canvas.tsx`, graph page

**Produces:** Click node → `id`, `purl`, depth, risk. Simulate/explain links use that `id`.

- [x] Two nodes with same purl remain distinct.

### Task 6: Timeline honesty

**Files:** `app/scans/[id]/timeline/page.tsx`

**Produces:** Keep unavailable-history headline. Optional caption list of **this scan’s** SSE events labeled “This scan”, not trust timeline.

### Task 7: Polish pass

**Files:** `PLAN.md` checkboxes, `design.md` if copy changes

**Produces:** `npm test`, `next build`, browser pass: Home, demo scan, Overview charts, Graph click, Attack, Remediate, reduced-motion.

- [x] Confirm unused tokens: pink used; magenta scarce; navy only on failure.

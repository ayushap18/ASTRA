---
name: astra-frontend
description: >-
  Build or change the Astra Next.js investigation UI. Use when editing apps/web,
  adding scan/dashboard routes, buttons, color blocks, SSE, graph, attack,
  timeline, or remediate screens.
---

# Astra frontend

Read `apps/web/design.md` before writing UI. One route per increment. Match existing proxy and component patterns.

## Sequence

1. Attack (`/scans/[id]/attack`) simulate with `package_id`
2. Remediate (`/scans/[id]/remediate`) proposal request
3. Graph XYFlow on `id`
4. Optional Sarvam explain (magenta, once per page)

## Must

- Inter + JetBrains Mono substitutes; pill buttons from `components/ui/button.tsx`
- Color-block mapping in design.md; white canvas between blocks
- Server proxy for core API and SSE
- Evidence IDs visible; AI labeled; no fabricated exploitability or verified patches

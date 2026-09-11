# Astra frontend design system

Monochrome editorial chrome, single look, no dark mode. Tailwind v4 (`app/globals.css`) + shadcn/ui (new-york, Radix). Invariants: unknown is never `0` or "safe"; `verified: true` is isolated-check evidence, not safety; magenta is only Sarvam; evidence ids never truncate.

## Tokens (`@theme` utilities + plain `--vars` on `:root`)

| Token | Value | Utility |
|---|---|---|
| canvas / ink | `#ffffff` / `#000000` | `bg-canvas` `text-ink` |
| hairline / hairline-soft | `#e6e6e6` / `#f1f1f1` | `border-hairline` |
| surface-soft | `#f7f7f5` | `bg-surface-soft` (hover wash) |
| block lime/lilac/cream/pink/mint/coral | `#dceeb1` `#c5b0f4` `#f4ecd6` `#efd4d4` `#c8e6cd` `#f3c9b6` | `bg-block-*` |
| block-navy | `#1f1d3d`, white text | `bg-block-navy` |
| accent-magenta | `#ff3d8b` — **Sarvam only** | `bg-accent-magenta` |
| success | `#1ea64a` — **glyph only** | `text-success` |
| chrome / chrome-2 | `#181c22` / `#232935` — console rail only | `bg-chrome` |

Radii: `rounded-xs` 2 · `-sm` 6 · `-md` 8 (cards, inputs) · `-lg` 24 (blocks) · `-xl` 32 · `-pill` 50 · `-full`. Spacing base 4px: `p-2`=8 `p-3`=12 `p-4`=16 `p-6`=24 `p-8`=32 `p-12`=48 `p-24`=96; `gap-section`=96, `p-block`=48. `xs:` = 560px. All `shadow-*` utilities are disabled.

shadcn vars are black/white/hairline only: `--muted-foreground` is `#000000` (hierarchy is weight, not gray), `--destructive` is black. next/font sets `--font-inter` / `--font-jetbrains`; `font-sans` / `font-mono` resolve through them.

## Typography

`.t-*` classes, or Tailwind sizes `text-display-xl` … `text-caption` (carry weight/leading/tracking):

| Class | Spec |
|---|---|
| `.t-display-xl` | 86 / 340 / 1.0 / -1.72px (64 at ≤768, 48 at ≤560) |
| `.t-display-lg` | 64 / 340 / 1.1 / -0.96px |
| `.t-headline` / `.t-subhead` | 26/540 · 26/340 |
| `.t-card-title` | 24 / 700 |
| `.t-body-lg` `.t-body` `.t-body-sm` | 20/330 · 18/320 · 16/330 |
| `.t-button` | 20 / 480 |
| `.t-eyebrow` / `.t-caption` | JetBrains Mono uppercase, 18px +0.54px · 12px +0.6px |
| `.mono-id` | mono 12px, `overflow-wrap: anywhere` |

Body default 18/320 Inter. De-emphasise with weight or `opacity-60`, never gray.

## Color blocks

One block per story, white between, never two in one viewport. `.block-lime` `.block-lilac` `.block-cream` `.block-pink` `.block-mint` `.block-coral` `.block-navy`: 24px radius, 48px padding, max-width 1280, no shadow; navy flips text and the primary button to white. `.block-gap` = the 96px white gap. ≤768: full-bleed, 0 radius, 32/24 padding; ≤560: 24/16 and pills inside `.cta` / `.actions` go full width. Tailwind form: `rounded-lg p-12 bg-block-lime max-md:rounded-none max-md:px-6`.

Cards: `Card` / `.card` (white, hairline, 8px). Inputs: `Input` / `.input` (8px, 12/14 padding, 44px). `.topnav` 56px white sticky; `.marquee` 36px black. Console shell only: `.console` `.rail` `.console-bar`.

## Buttons

`components/ui/shadcn-button.tsx`: every variant is a pill (`rounded-full`, `min-h-11`); no square, no destructive.

- `default` black pill · `secondary` white pill, hairline · `ghost` tertiary · `link` · `inverse` white on navy/chrome · `magenta` **Sarvam only** (outside `components/voice*`, `explain-control`, `lib/voice` fails review).
- sizes `default` 44px · `sm` (still 44px, 16px text) · `lg` · `icon`.

`components/ui/button.tsx` is the legacy wrapper: `tone="primary|secondary|magenta"` → `default|secondary|magenta`. Plain-CSS twin: `.pill.primary|secondary|magenta|inverse|sm`.

shadcn set: Button, Card, Badge, Tabs, Table, Progress, Input, Select, Dialog, Tooltip, Separator, Sheet, ScrollArea, Skeleton (`rows` kept). `lib/utils.ts` (`cn`) is UI-only — never import it, React, or `@/` from modules covered by `lib/**/*.test.ts`.

## Naming glossary

Allot a job → Start a scan · Digital Twin / instance → Installed dependency graph / installed copy · Experimental ATR → What-if: compromised package, "Blast radius: N of M packages reachable" · Instance Inspector → Package details · d0/d1 → depth 0 (direct)/depth 1 · Workbench focus → Selected package / finding · purl → "package id" · aggregation: pending → scoring in progress · Proposals only → Plan not verified · max changes → Upgrade budget · Timeline → folded into ScanProgress. `unknown` is the literal word everywhere; scores carry "heuristic 0–100; unknown shown as —".

## Legacy

The `LEGACY` tail of `globals.css` keeps every pre-redesign class so unmigrated routes render; delete rules there as routes move to Tailwind/shadcn.

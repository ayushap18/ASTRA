# PS #12 alignment — "the scan is a report"

Date: 2026-09-12. Winning IA: report-first, with judge grafts folded in. Tokens: see the Astra tokens → Tailwind/shadcn mapping doc (drop Section 1 into `globals.css` first; shadcn `add -o` only after `button.tsx` is renamed).

## Goal

Turn the Astra workbench into a single actionable security and risk report per scan, whose sections map one-to-one onto the six PS goals plus the remediation bonus. A newcomer answers "Can we ship?" at the top, sees per-goal coverage, and can print it. Invariants: unknown is never rendered as 0 or "safe"; `verified: true` is isolated-check evidence, not a safety claim; magenta is Sarvam only; evidence ids stay visible.

## Naming glossary

| Old | New |
|---|---|
| Allot a job | Start a scan |
| Dependency Digital Twin / instance | Installed dependency graph / installed copy |
| Experimental ATR, toxicity_radius | What-if: compromised package; "Blast radius: N of M packages reachable" |
| Instance Inspector | Package details |
| d0 / d1 | depth 0 (direct) / depth 1 |
| Workbench focus | Selected package / finding |
| purl | caption "package id" |
| aggregation: pending | scoring in progress |
| Proposals only | Plan not verified |
| max changes | Upgrade budget |
| evidence ev_… | Evidence ev_… (raw record) |
| Timeline / stage events | folded into ScanProgress; history gaps become explicit unknown rows in §4 |

`unknown` is the literal word everywhere. Scores carry the caption "heuristic 0–100; unknown shown as —". The radar is replaced by the coverage grid; if a radar survives anywhere, null axes draw as dashed "unknown" spokes.

## Backend data contract

Graph gains optional "project_license": string (root package.json license, "" when unknown). Package.metadata gains optional fields with these exact names and defaults: latest_published_at: string ""; major_gap: int 0; minor_gap: int 0; patch_gap: int 0 (semver distance installed to latest; all 0 also when unknown, and metadata.registry_status tells unknown from current); days_since_latest_publish: int -1 (unknown); maintainer_changed: bool false; previous_maintainers: list[str] []; version_jump: bool false; version_jump_note: string "". Intelligence findings gain kinds: "outdated" (fields upgrade_effort: "patch"|"minor"|"major", upgrade_note), "maintainer_change", "version_jump", "license_conflict" (project vs dependency incompatibility, plus denied list), "unmaintained" (days_since_latest_publish >= 730). Existing "lifecycle_capabilities" findings represent install-time scripts. Risk dimensions "maintenance" and "maintainer" become numbers when evidence exists, else None. Summary gains per-goal counts: {"goals": {"tree": {"direct","transitive","max_depth"}, "vulnerabilities": {"total","reachable","unknown_reach"}, "outdated": {"total","major","minor","patch"}, "suspicious": {"maintainer_changes","version_jumps","install_scripts"}, "license": {"conflicts","denied","unknown"}, "concentration": {"top_maintainer","top_maintainer_share","unmaintained"}}}. Remediation response keeps status/verified/changes with finding_ids per change. All counts derive only from evidence; unknown stays unknown.

## Routes and sections

Shell (all routes): 56px white sticky top nav with "Ops" link; 36px black marquee strip "npm only · unknown is never 0 · verified = isolated check, not safety". On `/scans/[id]/*` a persistent shadcn Tabs sub-nav under the top nav: Report · Graph · Upgrade plan · What-if (replaces `mode-nav.tsx`). `?package=&finding=` (lib/investigation.ts) is shared focus state across all four. A floating hold-to-talk pill opens a voice Sheet on every scan route. One scan list only (rail). Delete `components/ui/top-nav.tsx`, `components/ui/footer.tsx`, `app/scans/[id]/timeline/`.

### `/` — Start a scan
White: display "Dependency risk report", one sentence, Badge "npm only — other ecosystems not supported". **Lime block:** ScanForm — Tabs (GitHub / ZIP / package.json + lockfile), Input, Select project licence (default "read from package.json"), Checkbox checklist for denied licences, pill Buttons; voice hold-to-talk here (magenta glyph only). White: Table of recent reports — name, ecosystem, verdict Badge, risk/trust/confidence as numbers or "unknown", "Re-run" pill.

### `/scans/[id]` — The report
Sticky outline (Sheet on mobile). ScanProgress strip in the header while running. `@media print` hides nav, tabs, sheet, outline, voice pill.

**§0 Verdict (white).** "Can we ship?" → Badge ∈ {Blocked, Ship with fixes, Needs review, Unknown}. Three metric rows with inline definitions + Tooltip. Coverage grid: one Card per goal, status Implemented / Partial / Not analysed **plus one line of what is and isn't measured** ("Reachability: module-level only; function-level not analysed"). Absence of a finding is never absence of risk.

**§1 What's installed (Goal 1) — cream.** Table: package, version, direct/transitive Badge, depth, dev scope, evidence id (mono caption); both `astra-demo-parser` copies as distinct rows. Mini graph preview inside the block; package names deep-link to the graph with `?package=`. Caption "Resolved from package-lock v2/v3. No lockfile reconstruction."

**§2 Known vulnerabilities and reachability (Goal 2) — coral.** Table: OSV id, severity Badge ("severity unknown", never 50 or gray), package@version, Reachability pill `module observed (L2)` with `file:line` or `unknown (L0)`, severity-source caption ("OSV database_specific; CVSS not parsed → unknown"). Footer row "Function-level reachability not analysed; transitive packages not observed." Dialog shows raw evidence with ids. Sarvam Explain control lives here (magenta).

**§3 Outdated packages (Goal 3) — mint.** Table: installed → latest, published dates, versions behind (major/minor/patch gaps), Upgrade effort Badge + reason. When `registry_status` is unknown for all rows the section is one Card "Not analysed — registry latest/publish dates not collected." Never fabricated hours.

**§4 Suspicious changes (Goal 4) — pink.** Three fixed rows: Install-time scripts (capability Badges `network` `env` `shell`, hashed command in Tooltip); Maintainer change; Version jump. Rows with no history render "no history collected", never absent.

**§5 Licence conflicts (Goal 5) — lilac.** Header "Project licence: MIT | not declared". Table: package, licence, scope, verdict Badge ∈ {compatible, conflict, policy-denied, unknown}, rule fired. Empty licence → unknown.

**§6 Concentration risk (Goal 6) — navy, inverse ink.** Table maintainer → instances / total, direct/transitive split, Progress for share; one finding per maintainer over threshold. Row "Unmaintained: not assessed (no publish-history data)" when `days_since_latest_publish` is -1.

**§7 Plan summary (white).** Card "3 upgrades address 3 of 12 findings. Predicted risk 56 → 56." beside a "Why risk didn't move" Card listing uncovered findings by reason. Links "Open upgrade plan →". Export and Print buttons.

### `/scans/[id]/graph` — Installed dependency graph
XYFlow; lens Select recolours finding pins per goal; Package details Sheet lists every installed copy plus transitive path. Honours `?package=`.

### `/scans/[id]/attack` — What-if: compromised package
Always "Blast radius: N of M packages reachable", never a lone numeral; Tooltip expands the old ATR term.

### `/scans/[id]/remediate` — Upgrade plan
White header; "Verifier: online / offline / unknown" from `/api/v1/status` shown before the Verify button. "Why risk didn't move" Card. **One lime block:** Table of changes ordered by findings-per-cost: package, from → to, finding ids resolved, effort tier, `breaking_risk: unknown` verbatim; parser row "Transitive — no parent upgrade found; investigate builder". Second Table "Not fixable by upgrade" with reason per finding. Verified Badge `verified: false — isolated check not run`; when true, Tooltip "isolated install check passed — not a safety claim". Upgrade budget Select. ZIP verify Dialog.

### `/ops` — Operator dashboard
System, Queue, In flight, API usage, uptime as Cards on white. Nothing on the report page polls.

shadcn per route: Card, Badge, Table, Tooltip, Dialog, Select, Tabs, Checkbox, Progress, Sheet. `lib/utils.ts` never imported from tested modules.

## Remediation planner presentation

Greedy set cover over findings: each change shows the finding ids it resolves so a reader can add them up and reconcile with "N of M". The predicted risk line is always paired with the "Why risk didn't move" explanation, because uncovered findings (concentration, lifecycle script, licence) have no upgrade action. Verification is a separate column with its own status; a plan is "Plan not verified" until the isolated check runs, and passing never reads as safe.

## Operator dashboard and voice planner placement

Dashboard widgets leave `/` for `/ops`, linked from the top nav. Voice: hold-to-talk in the lime block on `/`, and a floating pill on every `/scans/[id]/*` route opening a Sheet so "explain DEMO-002 in Hindi" works mid-report. Sarvam glyph and Explain control are the only magenta.

## Demo walkthrough (5 min)

- 0:00 `/` — voice "scan the demo repo"; form fills, scan starts.
- 0:30 §0 — verdict Blocked; coverage grid shows Goals 3 and 4 partly not analysed, each card says what was measured.
- 1:15 §2 — parser finding `unknown (L0)` vs client `module observed (L2)` with `file:line`; evidence Dialog; Sarvam explain in Hindi.
- 2:30 §4/§5/§6 — install script capabilities; GPL conflict; one maintainer covers 6/6.
- 3:30 Graph — two parser copies; click builder ancestor via `?package=`.
- 4:00 Upgrade plan — 3 changes / 3 of 12; "Why risk didn't move"; `verified: false`; run ZIP verify.
- 4:40 §7 — Print / Download report. End.

## Agent checks

- No literal `0` or "safe" rendered where the contract says unknown (`-1`, `""`, `None`, `registry_status` unknown); grep for hard-coded fallbacks.
- Every finding row and evidence Dialog shows an `ev_` id.
- `#ff3d8b` appears only in Sarvam voice/explain components.
- One colour block per section, white between; no two blocks in one viewport at 1440×900.
- Tabs sub-nav present on all four scan routes; `?package=&finding=` preserved across tab switches.
- `timeline/`, `top-nav.tsx`, `footer.tsx` deleted; single scan list.
- `npm test`, `npm run lint`, `npm run typecheck` pass; print preview of `/scans/[id]` hides chrome.

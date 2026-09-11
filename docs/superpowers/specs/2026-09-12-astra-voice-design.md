# Astra Voice (read-only Sarvam + deterministic actions)

## Goal

Add a push-to-talk operator assistant to the investigation console. Spoken **actions** are parsed locally and call existing Astra APIs. Spoken **questions** are answered by Sarvam using an allowlisted fact card plus a sanitized utterance. Sarvam never chooses scans, simulations, remediations, or verification.

## Non-goals (this increment)

- Wake word or continuous listening
- Browser WebSockets to Sarvam (HTTP STT and TTS are enough for one utterance)
- Putting `SARVAM_API_KEY` or `ASTRA_API_TOKEN` in the browser
- Sending source, lockfiles, advisory prose, maintainer identities, or credential values to Sarvam
- Letting voice invent a ZIP, a GitHub PAT, or a `verified: true` safety claim
- AI involvement in dependency resolution, vulnerability matching, risk scoring, simulation decisions, or remediation selection

## Secrets

`SARVAM_API_KEY` stays in server env (intelligence already has it for Explain). Compose and laptop web also receive it for STT/TTS proxies. Operators rotate keys in Sarvam’s dashboard and set `.env`; keys must not be pasted into chat, git, or query strings.

If the key is empty, voice STT/TTS fail closed with a visible warning. Typed Explain keeps its existing deterministic fallback.

## Architecture

Hold a magenta control in `AppShell`. Capture one audio clip (browser `MediaRecorder`, webm/opus or wav). `POST /api/voice/stt` (Next.js) forwards at most 2 MiB to Sarvam speech-to-text with `api-subscription-key`. Larger bodies return 413. The transcript is not stored on the scan snapshot and is not written to application logs.

The transcript is classified **before** any Sarvam chat call:

1. If `apps/web/lib/voice/commands.ts` matches an action intent, run the action path. Do not send the utterance to chat for routing.
2. Else treat it as a read-only question: build a fact card from already-fetched scan/list JSON in the browser, `POST /api/voice/ask` with that card plus the utterance. The Next route sanitizes again server-side, calls Sarvam chat with the server key, and returns labeled text. Core and intelligence Explain stay unchanged.
3. Speak the reply via `POST /api/voice/tts`. Show transcript, spoken text, evidence IDs, `provider`, and `ai_generated` in the panel.

Ambiguous package names never collapse by `purl` or name. The operator picks an instance `id`.

## Action path (deterministic)

| Intent | Behavior |
| --- | --- |
| List / status | `GET /api/v1/scans`. Speak running/queued/total and queue limits (2 workers, 18 admitted). Surface `429 queue_full` honestly. |
| Open scan | Navigate to `/scans/{id}` when the id or unique repository is unambiguous. |
| Start demo | `POST /api/v1/scans` `{ "source": "demo" }` immediately. |
| Start GitHub | Immediate only when the transcript contains a canonical `https://github.com/owner/repo` (two path segments, no credentials). Never accept a token from speech. If GitHub is disabled or a PAT is required, hand off to the allot form. |
| Simulate | Immediate `POST .../simulate` after a unique `package_id`. Defaults match the Attack form payload helper. |
| Remediation | Parser proposes `{ max_changes }` (default 3, clamp 1–100). Visible confirm, then `POST .../remediation`. Speak `status: proposal` and `verified: false`. |
| Verify | Open the existing ZIP picker and confirm UI. Voice does not upload a file by itself. |

Lockfile/ZIP scan creation stays on the allot form. Simulate/explain require `completed` or `partial`; otherwise speak the `409` meaning.

## Planning

A compound utterance (parts split on `then`, `and then`, `after that`, `, and`) becomes a visible numbered plan in the voice panel: one deterministic command per part, status glyph per step, and Run / Cancel buttons. Nothing runs before the operator presses Run; a single non-confirmable command (list, open, ask) still executes immediately as before. Steps run in order; a failed step marks the rest skipped; the summary and each step's result are spoken.

When the local parser yields only questions but the transcript carries an action verb, `POST /api/voice/plan` asks Sarvam to PROPOSE steps from an allowlisted schema (`list | open_scan | start_demo | simulate | simulate_riskiest | remediate | verify | ask`). Every proposed step is re-validated locally with the same resolvers as speech: `package` must exactly match a `name@version` in the open scan (ambiguous → pick an instance id, unknown → not found), `scan_id` must exist in the scan list, unknown actions are dropped. Sarvam-planned steps always require Run and are captioned "planned by: Sarvam". Sarvam receives only the clipped fact card, the sanitized utterance, and `name@version` strings (max 100); never instance ids, scan ids beyond the card, or lockfile contents.

"The riskiest package" is deterministic: at run time the runner reads `/api/v1/scans/{id}/graph` and picks the maximum `risk.score` (ties → first); with no scores it speaks "no risk scores available" and does not guess. A plan that starts or opens a scan feeds the new id to later steps and polls the scan until `completed` or `partial` (1.5 s, up to 120 s) before simulate or remediate. A planned remediation still speaks `status proposal, verified false`.

## Question path (Sarvam)

Fact card allowlist (all optional when missing → treat as unknown, never invent zero/safe):

- scan `id`, `status`, `source` (not full git remote if it contains credentials; public `https://github.com/owner/repo` form is allowed)
- summary numbers: risk, trust, confidence, package counts, finding counts, `import_observed`, `execution_proven`
- selected package instance `id`, name, version, depth, reachability `level` and `status`
- finding `kind` values and severities (enumerated), vulnerability **count**
- evidence **ids** only
- `verified` boolean and remediation `status` when a proposal is on screen

Allowed extra field vs Explain: `utterance` string, max 500 characters, after stripping Bearer-like tokens, `sk_` keys, `github_pat` / `ghp_` prefixes, `user:pass@` URLs, and newlines. Language: STT `language_code=auto`; chat and TTS use the detected language when Sarvam returns one, otherwise `en-IN`.

System instruction remains: explain only supplied evidence; never invent a CVE, execution path, patch, or score; unknown is not safe.

If chat or TTS fails, speak the deterministic English summary of the fact card (or “Sarvam unavailable”) and keep the warning visible.

Refuse (speech + panel, no action): exploit/PoC requests, “is this patch safe”, dumping source, pasting secrets.

## UI

Magenta is only Sarvam (hold-to-talk + AI question replies). First use requests microphone permission. Reduced-motion: no pulsing mic animation.

Panel copy must not call proposals verified or risk “proven exploitability”.

## Tests and docs

Unit-test the parser and sanitizer with fixtures (demo, GitHub URL, simulate unique vs ambiguous package, remediate confirm required, refuse). Mock STT/TTS/ask in web tests; CI does not call live Sarvam.

Update `apps/web/design.md`, `docs/api.md` (voice routes as Next presentation, not core), `.env.example`, and Compose web env. `docs/analysis.md` must state the utterance allowlist expansion and that action routing stays deterministic.

## Agent checks

`make test`, `make lint`, `make build`. Skip live Sarvam in CI. Do not weaken existing Explain allowlist tests.

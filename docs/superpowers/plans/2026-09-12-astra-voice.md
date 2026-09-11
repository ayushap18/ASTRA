# Astra Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push-to-talk operator voice: local parser runs Astra actions; Sarvam STT/TTS/chat answers read-only questions from an allowlisted fact card.

**Architecture:** Next.js presentation layer only. `lib/voice` owns sanitizer, parser, fact-card clip, and Sarvam HTTP client (injectable `fetch`). Thin `app/api/voice/{stt,tts,ask}` routes attach `SARVAM_API_KEY` and never expose it. Browser `VoiceControl` in `AppShell` records one clip, classifies the transcript locally, then calls `/api/v1` or `/api/voice/ask`. Core and intelligence Explain stay unchanged.

**Tech Stack:** Next 15 App Router, existing `node --test` web tests, Sarvam REST (`https://api.sarvam.ai/speech-to-text`, `/text-to-speech`, `/v1/chat/completions`), no new npm packages.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-12-astra-voice-design.md`
- `SARVAM_API_KEY` and `ASTRA_API_TOKEN` never in the browser or query strings
- Parser classifies **before** any chat call; Sarvam never selects simulate/remediate/verify/scan
- Package identity is instance `id`; never collapse by name or purl
- Missing evidence is unknown, never zero/safe; `verified: true` is not a safe-patch claim
- Magenta is only Sarvam (mic + AI replies)
- STT auto-language field is Sarvam `language_code=unknown` (API name for auto-detect)
- Audio POST max 2 MiB → 413; do not log audio or transcripts
- CI never calls live Sarvam; do not weaken `services/intelligence/tests/test_api.py` allowlist tests
- Skip git commit steps unless the operator explicitly asked to commit

## File map

| File | Responsibility |
| --- | --- |
| `apps/web/lib/voice/sanitize.ts` | Utterance sanitizer |
| `apps/web/lib/voice/facts.ts` | Fact-card clip + deterministic English fallback |
| `apps/web/lib/voice/commands.ts` | Transcript → action or `ask` / `refuse` |
| `apps/web/lib/voice/sarvam.ts` | STT/TTS/ask with injected fetch |
| `apps/web/lib/voice/*.test.ts` | Unit tests |
| `apps/web/app/api/voice/stt/route.ts` | Proxy STT |
| `apps/web/app/api/voice/tts/route.ts` | Proxy TTS |
| `apps/web/app/api/voice/ask/route.ts` | Re-sanitize + chat |
| `apps/web/components/voice-control.tsx` | Hold-to-talk UI |
| `apps/web/components/app-shell.tsx` | Mount control |
| `apps/web/components/remediate-form.tsx` | Listen for verify-handoff focus |
| `apps/web/package.json` | `lib/**/*.test.ts` glob |
| `infra/compose.yaml`, `.env.example`, docs | Key on web; document routes |

---

### Task 1: Sanitizer and fact card

**Files:**
- Create: `apps/web/lib/voice/sanitize.ts`
- Create: `apps/web/lib/voice/facts.ts`
- Create: `apps/web/lib/voice/sanitize.test.ts`
- Create: `apps/web/lib/voice/facts.test.ts`
- Modify: `apps/web/package.json` test script to `"test": "node --experimental-strip-types --test lib/**/*.test.ts"`

**Interfaces:**
- Consumes: nothing
- Produces: `sanitizeUtterance(raw: string): string`; `VoiceFactCard`; `clipFactCard(input: unknown): VoiceFactCard`; `deterministicAskText(card: VoiceFactCard): string`

- [ ] **Step 1: Extend the test glob and write failing tests**

```json
"test": "node --experimental-strip-types --test lib/**/*.test.ts"
```

```ts
// apps/web/lib/voice/sanitize.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeUtterance } from "./sanitize.ts";

test("strips secrets, urls with userinfo, newlines, and caps length", () => {
  const raw = "explain Bearer abc.def sk_secret ghp_aaaa github_pat_bbbb https://u:p@github.com/acme/app why\nrisk";
  const out = sanitizeUtterance(raw);
  assert.equal(out.includes("Bearer"), false);
  assert.equal(out.includes("sk_secret"), false);
  assert.equal(out.includes("ghp_"), false);
  assert.equal(out.includes("github_pat_"), false);
  assert.equal(out.includes("u:p@"), false);
  assert.equal(out.includes("\n"), false);
  assert.ok(sanitizeUtterance("x".repeat(800)).length <= 500);
});
```

```ts
// apps/web/lib/voice/facts.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { clipFactCard, deterministicAskText } from "./facts.ts";

test("clipFactCard drops source, lockfile, and advisory prose", () => {
  const card = clipFactCard({
    scan_id: "as_1",
    status: "completed",
    source: "github",
    repository: "https://github.com/acme/app",
    summary: { risk: 42, trust: 58, confidence: null },
    package: { id: "inst-1", name: "lodash", version: "4.17.19", depth: 1, reachability_level: 0, reachability_status: "unknown" },
    finding_kinds: ["vulnerability"],
    finding_severities: ["high"],
    vulnerability_count: 2,
    evidence_ids: ["ev:1"],
    verified: false,
    remediation_status: "proposal",
    lockfile: { lockfileVersion: 3 },
    advisory: "RCE in foo",
    source_text: "require('child_process')",
  });
  assert.equal(card.scan_id, "as_1");
  assert.equal(card.summary?.confidence, null);
  assert.equal("lockfile" in card, false);
  assert.equal("advisory" in card, false);
  assert.equal("source_text" in card, false);
  assert.match(deterministicAskText(card), /unknown/i);
  assert.doesNotMatch(deterministicAskText(card), /safe patch/i);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npm test`

Expected: FAIL resolving `./sanitize.ts` / `./facts.ts`

- [ ] **Step 3: Minimal implementation**

`sanitizeUtterance`: replace `/\n+/g` with space; remove `Bearer\s+\S+`, `\bsk_[A-Za-z0-9_]+`, `\bghp_[A-Za-z0-9]+`, `\bgithub_pat_[A-Za-z0-9_]+`, `https?:\/\/[^/\s]*:[^/\s]*@\S+`; collapse spaces; `slice(0, 500)`.

`VoiceFactCard` fields exactly as spec (optional). `clipFactCard` copies only those keys; nested `summary` copies numeric-or-null keys `risk`, `trust`, `confidence`, `packages`, `direct`, `transitive`, `import_observed`, `execution_proven`, `findings`. Drop `repository` if it contains `@` or is not `https://github.com/owner/repo` (optional `.git`). `deterministicAskText` states known numbers, says unknown when null/missing, ends with “Unknown is not safe. This is not a verified patch.”

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npm test`

Expected: PASS (existing `lib/*.test.ts` plus new files)

- [ ] **Step 5: Commit** (only if the operator asked)

```bash
git add apps/web/package.json apps/web/lib/voice
git commit -m "$(cat <<'EOF'
Add voice utterance sanitizer and allowlisted fact cards.

EOF
)"
```

---

### Task 2: Deterministic command parser

**Files:**
- Create: `apps/web/lib/voice/commands.ts`
- Create: `apps/web/lib/voice/commands.test.ts`

**Interfaces:**
- Consumes: none
- Produces:

```ts
export type VoicePackage = { id: string; name: string; version: string };
export type VoiceScan = { id: string; repository?: string };
export type VoiceContext = {
  pathname: string;
  scanId?: string;
  scanStatus?: string;
  packages: VoicePackage[];
  scans: VoiceScan[];
};
export type VoiceCommand =
  | { type: "list" }
  | { type: "open_scan"; scanId: string }
  | { type: "start_demo" }
  | { type: "start_github"; repository: string }
  | { type: "handoff_allot"; reason: "github_form" | "zip" }
  | { type: "simulate"; packageId: string }
  | { type: "simulate_ambiguous"; candidates: VoicePackage[] }
  | { type: "simulate_missing" }
  | { type: "not_ready"; action: "simulate" | "remediate" }
  | { type: "remediate"; maxChanges: number }
  | { type: "verify_handoff" }
  | { type: "refuse"; reason: "exploit" | "safe_patch" | "source" | "secret" }
  | { type: "ask" };
export function parseVoiceCommand(transcript: string, ctx: VoiceContext): VoiceCommand;
export function githubRepositoryFromTranscript(transcript: string): string | null;
```

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { parseVoiceCommand, type VoiceContext } from "./commands.ts";

const pkgs = [
  { id: "i1", name: "lodash", version: "4.17.19" },
  { id: "i2", name: "lodash", version: "4.17.20" },
  { id: "i3", name: "hono", version: "4.11.4" },
];
const ctx = (over: Partial<VoiceContext> = {}): VoiceContext => ({
  pathname: "/scans/as_abc",
  scanId: "as_abc",
  scanStatus: "completed",
  packages: pkgs,
  scans: [{ id: "as_abc", repository: "https://github.com/acme/app.git" }],
  ...over,
});

test("list and demo and github url", () => {
  assert.equal(parseVoiceCommand("list scans", ctx()).type, "list");
  assert.deepEqual(parseVoiceCommand("start a demo scan", ctx()), { type: "start_demo" });
  assert.deepEqual(parseVoiceCommand("scan https://github.com/altcha-org/altcha-starter-nodejs-ts", ctx()), {
    type: "start_github",
    repository: "https://github.com/altcha-org/altcha-starter-nodejs-ts",
  });
  assert.deepEqual(parseVoiceCommand("scan github.com/acme/app/tree/main", ctx()), {
    type: "handoff_allot",
    reason: "github_form",
  });
});

test("simulate unique vs ambiguous vs not ready", () => {
  assert.deepEqual(parseVoiceCommand("simulate hono", ctx()), { type: "simulate", packageId: "i3" });
  const amb = parseVoiceCommand("simulate lodash", ctx());
  assert.equal(amb.type, "simulate_ambiguous");
  assert.equal(parseVoiceCommand("simulate hono", ctx({ scanStatus: "running" })).type, "not_ready");
});

test("remediate confirm payload, verify handoff, refuse", () => {
  assert.deepEqual(parseVoiceCommand("propose remediations with 5 changes", ctx()), {
    type: "remediate",
    maxChanges: 5,
  });
  assert.deepEqual(parseVoiceCommand("run verify", ctx()), { type: "verify_handoff" });
  assert.equal(parseVoiceCommand("write an exploit poc", ctx()).type, "refuse");
  assert.equal(parseVoiceCommand("is this patch safe", ctx()).type, "refuse");
  assert.equal(parseVoiceCommand("dump the source file", ctx()).type, "refuse");
  assert.equal(parseVoiceCommand("use ghp_aaaaaaaa", ctx()).type, "refuse");
});

test("open unique scan by repo fragment", () => {
  assert.deepEqual(parseVoiceCommand("open altcha-starter-nodejs-ts", ctx({
    scans: [{ id: "as_9", repository: "https://github.com/altcha-org/altcha-starter-nodejs-ts.git" }],
  })), { type: "open_scan", scanId: "as_9" });
});

test("unmatched question falls through to ask", () => {
  assert.deepEqual(parseVoiceCommand("why is risk forty two", ctx()), { type: "ask" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && node --experimental-strip-types --test lib/voice/commands.test.ts`

Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Order inside `parseVoiceCommand` (first match wins):

1. Refuse if `/exploit|poc|proof of concept/i`, `/patch safe|verified safe|safe to ship/i`, `/dump (the )?source|show source file/i`, `/\bghp_|\bgithub_pat_|\bsk_[a-z0-9]/i`, `/Bearer\s+\S/i`
2. `githubRepositoryFromTranscript`: match `https://github.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+` with no extra path/query/userinfo; strip trailing `.git` for the returned canonical URL. If transcript has `scan`/`github` plus that URL → `start_github`. If transcript asks to scan github without a valid URL → `handoff_allot` `github_form`.
3. `/demo scan|start (a )?demo/i` → `start_demo`
4. `/list scans|queue status|how many scans/i` → `list`
5. `/open (scan )?as_[a-f0-9]+/i` or unique repository substring among `ctx.scans` → `open_scan`; if 0 or >1 repo hits and no id → `ask`
6. `/verify|isolated test|run (the )?build/i` → `verify_handoff`
7. `/remediat|fix plan|propose changes/i` → `remediate` with `maxChanges` from `/(\d+)\s*changes?/` else `3`, clamp 1–100
8. `/simulate|attack|compromise/i` plus a package token: if status not `completed`/`partial` → `not_ready` `simulate`. Resolve by case-insensitive `name` then `name@version`. 1 match → `simulate`; >1 → `simulate_ambiguous`; 0 → `simulate_missing`
9. Else `ask`

ZIP/lockfile “upload my project” → `handoff_allot` `zip`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npm test`

Expected: PASS

- [ ] **Step 5: Commit** (only if asked)

```bash
git add apps/web/lib/voice/commands.ts apps/web/lib/voice/commands.test.ts
git commit -m "$(cat <<'EOF'
Parse voice actions without sending them to Sarvam.

EOF
)"
```

---

### Task 3: Sarvam HTTP client (mocked)

**Files:**
- Create: `apps/web/lib/voice/sarvam.ts`
- Create: `apps/web/lib/voice/sarvam.test.ts`

**Interfaces:**
- Consumes: `sanitizeUtterance`, `clipFactCard`, `deterministicAskText`
- Produces:

```ts
export const STT_MAX_BYTES = 2 * 1024 * 1024;
export type FetchLike = typeof fetch;
export function missingSarvamKey(): boolean; // !process.env.SARVAM_API_KEY
export async function transcribeAudio(file: Blob, fetchImpl?: FetchLike): Promise<{ transcript: string; language: string }>;
export function normalizeTtsLanguage(language: string): string;
export async function synthesizeSpeech(text: string, language: string, fetchImpl?: FetchLike): Promise<Blob>;
export async function askSarvam(card: unknown, utterance: string, language: string, fetchImpl?: FetchLike): Promise<{
  text: string; provider: string; language: string; ai_generated: boolean; warnings: string[]; evidence_ids: string[];
}>;
```

STT: `POST https://api.sarvam.ai/speech-to-text` header `api-subscription-key`, multipart `file` + `model=saaras:v3` + `language_code=unknown`. Read `transcript` and `language_code` (fallback `en-IN`).

TTS: `POST https://api.sarvam.ai/text-to-speech` JSON `{ text: text.slice(0, 500), language_code: normalizeTtsLanguage(language), model: "bulbul:v3", speaker: "shubh", output_audio_codec: "mp3" }`. Supported languages are `bn-IN|en-IN|gu-IN|hi-IN|kn-IN|ml-IN|mr-IN|od-IN|pa-IN|ta-IN|te-IN`; any other/empty detected value falls back to `en-IN`. Response `audios[0]` is base64 MP3 → `audio/mpeg` Blob.

Ask: chat `POST https://api.sarvam.ai/v1/chat/completions` same pattern as `services/intelligence/app/ai/interpreter.py` (`temperature: 0`, `max_tokens: 500`, model `process.env.SARVAM_MODEL || "sarvam-105b"`). User content is `JSON.stringify({ ...clipFactCard(card), utterance: sanitizeUtterance(utterance) }, Object.keys(...).sort()` — sort keys on the object). System: “Explain only the supplied security evidence. Never invent a vulnerability, execution path, patch, or score. Distinguish unknown from safe. This is commentary on deterministic analysis. Reply in language ” + language. On missing key or HTTP error: `{ text: deterministicAskText(clipFactCard(card)), provider: "deterministic", ai_generated: false, warnings: ["Sarvam unavailable; returning the evidence summary."], evidence_ids: card.evidence_ids ?? [], language }`. Empty key for STT/TTS throws `Error` with code-like message `sarvam_unconfigured`.

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { askSarvam, STT_MAX_BYTES, transcribeAudio } from "./sarvam.ts";

test("STT budget is 2 MiB", () => {
  assert.equal(STT_MAX_BYTES, 2 * 1024 * 1024);
});

test("transcribeAudio uses api-subscription-key and unknown language", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push(String(input));
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), null);
    assert.ok(headers.get("api-subscription-key"));
    return new Response(JSON.stringify({ transcript: "list scans", language_code: "en-IN" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  process.env.SARVAM_API_KEY = "test-key";
  const out = await transcribeAudio(new Blob(["x"]), fetchImpl);
  assert.equal(out.transcript, "list scans");
  assert.equal(out.language, "en-IN");
  assert.equal(calls[0], "https://api.sarvam.ai/speech-to-text");
});

test("askSarvam sends clipped card and falls back without a key", async () => {
  delete process.env.SARVAM_API_KEY;
  let called = false;
  const fetchImpl: typeof fetch = async () => {
    called = true;
    return new Response("no", { status: 500 });
  };
  const result = await askSarvam(
    { scan_id: "as_1", summary: { risk: 42 }, lockfile: { lockfileVersion: 3 } },
    "why risk Bearer tok",
    "en-IN",
    fetchImpl,
  );
  assert.equal(called, false);
  assert.equal(result.ai_generated, false);
  assert.equal(result.provider, "deterministic");
  assert.ok(result.warnings.length > 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && node --experimental-strip-types --test lib/voice/sarvam.test.ts`

Expected: FAIL module not found

- [ ] **Step 3: Implement `sarvam.ts` as specified in Interfaces**

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npm test`

Expected: PASS

- [ ] **Step 5: Commit** (only if asked)

---

### Task 4: Next.js voice routes

**Files:**
- Create: `apps/web/app/api/voice/stt/route.ts`
- Create: `apps/web/app/api/voice/tts/route.ts`
- Create: `apps/web/app/api/voice/ask/route.ts`
- Create: `apps/web/lib/voice/routes.test.ts`

These are thin; logic lives in Task 3. No live Sarvam in tests.

**STT `POST`:** If no key → `503` `{ error: { code: "sarvam_unconfigured", message: "Sarvam is not configured" } }`. Read `request.arrayBuffer()`; if `byteLength > STT_MAX_BYTES` → `413` `{ error: { code: "audio_too_large", message: "Audio exceeds 2 MiB" } }`. `transcribeAudio(new Blob([buf], { type: request.headers.get("content-type") || "application/octet-stream" }))`. Return `{ transcript, language }` (do not echo audio). Catch → `502` `{ error: { code: "sarvam_unavailable", message: "Speech recognition failed" } }` — message must not include provider body.

**TTS `POST` JSON:** `{ text: string, language?: string }`. Empty key 503. `synthesizeSpeech(text, language || "en-IN")` → `audio/mpeg` body `Cache-Control: no-store`.

**ASK `POST` JSON:** `{ card: unknown, utterance: string, language?: string }`. Always `clipFactCard` + `sanitizeUtterance` on the server even if the client already did. Return askSarvam JSON.

- [ ] **Step 1: Write failing route tests**

Import each route's `POST` directly. With no key, assert STT/TTS return 503 and `sarvam_unconfigured`. Send a body larger than `STT_MAX_BYTES` with a temporary test key and assert STT returns 413 without calling a live provider. Send an ASK card containing `lockfile` and a secret-bearing utterance through an injected/test-only Sarvam client boundary, then assert the provider input contains neither.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && node --experimental-strip-types --test lib/voice/routes.test.ts`

Expected: FAIL resolving route modules

- [ ] **Step 3: Implement the three `route.ts` files**

Each route exports `maxDuration = 60`. Keep provider calls in `sarvam.ts`; route modules only validate, bound, and translate responses.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npm test`

Expected: PASS with no live Sarvam request.

- [ ] **Step 5: Commit** (only if asked)

---

### Task 5: Voice control UI

**Files:**
- Create: `apps/web/components/voice-control.tsx`
- Create: `apps/web/lib/voice/dispatch.ts`
- Create: `apps/web/lib/voice/dispatch.test.ts`
- Modify: `apps/web/components/app-shell.tsx` — render `<VoiceControl scans={scans} />` in the top bar
- Modify: `apps/web/components/remediate-form.tsx` — `useEffect` listen `astra-voice-verify` → `document.getElementById("verify-zip")?.focus()`
- Modify: `apps/web/components/remediate-form.tsx` — give the file input `id="verify-zip"`
- Modify: `apps/web/app/globals.css` — `.voice-panel`, `prefers-reduced-motion` disables pulse

**Interfaces:**
- Consumes: `parseVoiceCommand`, `clipFactCard`, `simulatePayload` from `lib/payloads.ts` with `{ packageId, ciInstall: false, lifecycleScripts: false, categories: [] }`, `remediationPayload`, `api()` from `lib/types.ts`
- Produces: `dispatchVoiceCommand(command, deps): Promise<VoiceDispatchResult>` in `lib/voice/dispatch.ts`; hold-to-talk magenta `Button tone="magenta"` delegates non-media behavior to it

Behavior:

1. `pointerdown`/`keydown Space` (when control focused): `navigator.mediaDevices.getUserMedia({ audio: true })`, `MediaRecorder`, collect chunks.
2. `pointerup`/`keyup`: stop, `POST /api/voice/stt` with the blob (not JSON). Show `Checking…` not the raw audio.
3. `parseVoiceCommand(transcript, { pathname, scanId from /scans/([^/]+)/, scanStatus from matching scans[], packages from last GET graph cached in component state — fetch graph when scanId set and status completed/partial, scans from props })`.
4. `dispatchVoiceCommand` dispatches:
   - `list`: `GET /api/v1/scans` via existing client; speak `${running} running, ${queued} queued, ${total} total. Two workers, eighteen admitted.`
   - `open_scan`: `router.push(/scans/${id})`
   - `start_demo`: `POST /api/v1/scans` `{ source: "demo" }` then push
   - `start_github`: `POST` `{ source: "github", repository }` ; on 403 `github_disabled` hand off `/#scan`
   - `handoff_allot`: `router.push("/#scan")` and speak the reason
   - `simulate`: `POST .../simulate` with `simulatePayload`; speak “Simulation is hypothetical. Ancestry is not an execution path.”
   - `simulate_ambiguous`: list candidate `id`s in the panel; do not call API
   - `not_ready`: speak wait for completed or partial
   - `remediate`: set local `pendingRemediation = maxChanges` and show Confirm pill; on confirm `POST remediation`; speak `proposal, verified false`
   - `verify_handoff`: `router.push(/scans/${scanId}/remediate)` then `window.dispatchEvent(new Event("astra-voice-verify"))`
   - `refuse`: speak “I will not do that.” + reason; no API
   - `ask`: build card from current scan summary + selected `?package=` if present; `POST /api/voice/ask`; show `ai_generated` caption; magenta only when `ai_generated`
5. Always `POST /api/voice/tts` with reply text; `Audio(URL.createObjectURL(blob)).play()`. If TTS 503, keep text visible.
6. Missing mic permission: visible error, no crash.
7. Panel shows transcript, reply, `provider`, `ai_generated`, evidence ids. Never “safe patch”.

- [ ] **Step 1: Write failing dispatcher tests**

Use injected `api`, `navigate`, and `handoffVerify` functions. Assert `start_demo` POSTs exactly `{ source: "demo" }`; `simulate` uses the instance id and safe defaults; `remediate` returns a confirmation state without POSTing; confirmation POSTs bounded `max_changes`; `refuse` makes zero API calls.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && node --experimental-strip-types --test lib/voice/dispatch.test.ts`

Expected: FAIL resolving `dispatch.ts`

- [ ] **Step 3: Implement dispatcher, control, shell mount, verify focus, and CSS**

Keep `MediaRecorder` and audio playback in `voice-control.tsx`; all command effects go through the tested dispatcher. Reduced motion disables recording pulse.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npm test`

Expected: PASS. Then manually hold the mic on the dashboard and say “list scans”; manual media testing supplements, not replaces, unit coverage.

- [ ] **Step 5: Commit** (only if asked)

---

### Task 6: Docs and Compose env

**Files:**
- Modify: `infra/compose.yaml` web `environment` add `SARVAM_API_KEY: ${SARVAM_API_KEY:-}` and `SARVAM_MODEL: ${SARVAM_MODEL:-sarvam-105b}`
- Modify: `.env.example` comment that web uses the same key for STT/TTS/ask
- Modify: `apps/web/design.md` — magenta hold-to-talk in the shell
- Modify: `docs/api.md` — section **Voice (Next.js presentation)** documenting `POST /api/voice/stt|tts|ask` are **not** core routes; no bearer Sarvam key in browser
- Modify: `docs/analysis.md` Interpreter boundary: Explain still excludes freeform queries; Voice ask may send a sanitized ≤500 char `utterance` plus the fact-card allowlist; action routing is deterministic and not performed by Sarvam
- Modify: `apps/web/README.md` one paragraph on mic + `.env.local` `SARVAM_API_KEY` for laptop `make web`

- [ ] **Step 1:** Edit the files above. No placeholder “TBD”.

- [ ] **Step 2:** Confirm `docs/api.md` table of core routes does **not** gain `/api/voice/*`.

- [ ] **Step 3:** Commit (only if asked)

---

### Task 7: Agent verification

- [ ] **Step 1:** `cd /Users/ayush18/muj && make test`

Expected: Go race tests pass, Python pytest pass, web tests include voice files, `# fail 0`

- [ ] **Step 2:** `make lint` then `make build`

Expected: vet, ruff, next lint, tsc, `bin/astra`, Next production build

- [ ] **Step 3:** Do not run live Sarvam in CI. If an operator key exists locally, optional manual: hold-to-talk “list scans” and one question on a completed scan. If key missing, UI shows `sarvam_unconfigured` and Explain still falls back.

- [ ] **Step 4:** Confirm intelligence `test_sarvam_payload_allowlist_excludes_source_and_prose` still passes.

---

## Spec coverage

| Spec item | Task |
| --- | --- |
| Push-to-talk, magenta, mic permission | 5 |
| HTTP STT/TTS, 2 MiB, 413, no transcript logs | 3, 4 |
| Parser before chat | 2, 5 |
| `/api/voice/ask` re-sanitize + fact card | 1, 3, 4 |
| Actions: list, open, demo, github, simulate, remediate confirm, verify picker | 2, 5 |
| Ambiguous instance `id` | 2 |
| Refuse exploit/safe/source/secrets | 2 |
| Compose/web key, docs | 6 |
| `make test/lint/build`, no live Sarvam CI | 7 |
| Core/Explain unchanged | 4, 6 |

WebSocket STT/TTS, wake word, and PAT-in-speech are explicitly out of this plan.

# Backend API

Base: `http://127.0.0.1:8080`. JSON field names are `snake_case`. Public endpoints require `Authorization: Bearer <ASTRA_API_TOKEN>` when configured, except `/health`. `/ready` and `/metrics` require the token. The token identifies one trusted operator deployment; it is not a tenant/session system.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/v1/scans` | Scan summaries, newest first (`limit` 1–200, optional `status`) |
| POST | `/api/v1/scans` | Validate input, persist queued state, return 202 and scan ID |
| GET | `/api/v1/scans/{id}` | Scan status, analysis summary/results, events; graph fetched separately |
| GET | `/api/v1/scans/{id}/events` | SSE stream; supports `Last-Event-ID` replay |
| GET | `/api/v1/scans/{id}/graph` | Normalized packages, edges, evidence and warnings; available during scan |
| GET | `/api/v1/scans/{id}/findings` | Findings and project summary after analysis |
| GET | `/api/v1/scans/{id}/evidence` | Evidence records |
| POST | `/api/v1/scans/{id}/simulate` | Hypothetical compromise of a stored package instance |
| POST | `/api/v1/scans/{id}/remediation` | Candidate remediation plan |
| POST | `/api/v1/scans/{id}/verify` | Isolated test/build check for a proposal |
| POST | `/api/v1/scans/{id}/explain` | Evidence interpretation for one package |
| GET | `/health` | API liveness |
| GET | `/ready` | Database and intelligence readiness |
| GET | `/metrics` | Prometheus-format request count and queued/running scan gauge |
| GET | `/api/v1/status` | Endpoint inventory, dependency health and per-route usage counters |

## Status and usage

`GET /api/v1/status` returns service version and uptime, effective config (demo/GitHub flags, storage kind, verifier and Sarvam configuration, queue depth), store and intelligence probe results, and one entry per route above with `usage` (`count`, `errors` for status ≥ 400, `last_status`, `last_seen`, `avg_ms`). Counters are in-memory per process and reset on restart; requests to unknown paths are counted under `other` and not listed.

## Create a scan

Offline fixture:

```json
{"source":"demo","denied_licenses":["GPL-3.0-only"]}
```

Inline npm inputs:

```json
{
  "source": "lockfile",
  "manifest": {"name":"sample","dependencies":{"lodash":"4.17.19"}},
  "lockfile": {
    "lockfileVersion": 3,
    "packages": {
      "": {"name":"sample","dependencies":{"lodash":"4.17.19"}},
      "node_modules/lodash": {"version":"4.17.19","license":"MIT"}
    }
  },
  "sources": {"src/index.ts":"import lodash from 'lodash';"},
  "denied_licenses": []
}
```

Use exact contents of your manifest and lockfile in real requests. The `sources` map is optional. Supported JavaScript and TypeScript file contents are passed only to Astra's internal Tree-sitter analysis and are not stored in scan snapshots or sent to Sarvam. AST module references do not prove execution; without source files, reachability stays unknown. A lockfile scan uses live npm and OSV providers; `demo` uses only synthetic records.

Public GitHub repository (requires `ASTRA_ENABLE_GITHUB=true`):

```json
{"source":"github","repository":"https://github.com/company/project"}
```

Optional `github_token` is a PAT used only as an HTTP header during the ephemeral clone. It is never written into scan snapshots, events, or logs. Do not put credentials in the repository URL. Private repositories work only with a valid token on an isolated operator deployment. The repository root must have `package.json` and `package-lock.json`. Source inspection covers JS/TS files in `src/` and `app/`.

A project ZIP is not a core source type. The web client unpacks it locally and submits `source: "lockfile"` with the extracted manifest, lockfile, and allowed source files.

Response:

```json
{"scan_id":"as_...","status":"queued","events_url":"/api/v1/scans/as_.../events"}
```

States: `queued → running → completed | partial | failed`. Partial means usable results exist with explicit input/provider gaps. Failed scans can retain a partially constructed graph. Store warnings and evidence confidence separately from severity in the frontend.

## Simulate

Always use the opaque `id` returned by the graph, not a package name or purl:

```json
{
  "package_id": "<graph.packages[i].id>",
  "ci_install": true,
  "lifecycle_scripts_enabled": true,
  "credential_categories": ["repository_token", "cloud_credentials"]
}
```

CI assumptions default to false. Credential categories are restricted to `repository_token`, `cloud_credentials`, and `database`; there is no secret-value field. Exposure is conditional on the selected assumptions. Reverse dependency paths represent installed ancestry, not application execution.

## Remediate

```json
{"max_changes":3}
```

The result has `status: "proposal"` and `verified: false`. Direct upgrades are re-parsed from the stored lockfile when that bump does not add new child packages; `predicted_risk` is the re-analyzed summary risk. Transitive-only proposals and incompatible trees leave `predicted_risk` null. Tests and builds are not run on this route. The client must not label these results a verified safe plan. Public scan JSON does not include the stored lockfile.

## Verify

`multipart/form-data` with `max_changes` (1–100) and `project` (ZIP, 8 MiB). The ZIP is used once and is not stored. It must include root `package.json` / `package-lock.json` whose lockfile bytes match the scan snapshot. Demo scans return 422. Core never mounts Docker; it calls `astra-verifier` when `ASTRA_VERIFIER_URL` is set.

`verified: true` only if `npm ci --ignore-scripts` succeeds, every declared `test`/`build` script exits 0 in a network-disabled container, registry/OSV status on the bumped graph is `available` or `fixture`, and `predicted_risk` was produced. That flag means those checks passed for this changeset. It is not a safety, exploitability, or production-readiness claim. Missing verifier, failed scripts, or incomplete coverage leave `verified: false`.

## Explain

```json
{"package_id":"<graph.packages[i].id>","language":"hi","use_ai":true}
```

Without `use_ai`, no AI request occurs. With it, `SARVAM_API_KEY` enables the optional interpreter. It receives only numeric risk dimensions, confidence, finding kinds, vulnerability count, and reachability level. When unavailable, the response returns the deterministic English explanation and a warning. Inspect `provider`, `language`, `requested_language`, and `ai_generated` rather than inferring successful translation from the request.

## Voice (Next.js presentation)

These routes are served by `apps/web`, not core, and are **not** part of the table above. They exist so the browser never holds `SARVAM_API_KEY`; the key lives only in the web server environment (Compose `web`, or `apps/web/.env.local`). Requests are proxied to Sarvam with `api-subscription-key`. Transcripts and utterances are not stored on the scan snapshot and are not logged.

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| POST | `/api/voice/stt` | Raw audio body (`audio/webm` or `audio/wav`), at most 2 MiB | `{"transcript":"...","language":"hi"}` |
| POST | `/api/voice/tts` | `{"text":"...","language":"hi"}` | `audio/mpeg` bytes |
| POST | `/api/voice/ask` | `{"card":{...},"utterance":"...","language":"hi"}` | `{"text","provider","language","ai_generated","warnings","evidence_ids"}` |
| POST | `/api/voice/plan` | `{"card":{...},"utterance":"...","packages":["name@version"],"language":"hi"}` | `{"steps":[{"action","package"?,"scan_id"?,"max_changes"?}],"provider","ai_generated"}`; missing key → 200 with empty steps |

Statuses: 413 audio over 2 MiB, 503 `sarvam_unconfigured` when the key is missing, 502 `sarvam_unavailable` when Sarvam fails or times out. `ask` re-sanitizes the utterance (≤500 characters) and accepts only the fact-card allowlist described in [analysis](analysis.md#interpreter-boundary). Navigation and actions (list, open, start, simulate, remediate, verify) are routed by a deterministic parser in the web client before any Sarvam call and never by the model. `plan` lets Sarvam *propose* steps from an allowlisted action schema; the client re-validates every step locally (package `name@version` → instance id, scan ids must exist) and nothing runs until the operator presses Run. Core routes and the Explain payload are unchanged.

## Streaming and errors

SSE records contain `id`, event name, and a JSON event with stage, progress, message, and timestamp. Reconnect with `Last-Event-ID`; only subsequent events are replayed. Terminal scans replay and close. Streaming is based on persisted stage events; individual package progress is not yet streamed.

Use authenticated `fetch` streaming from the frontend or a server proxy. Native browser `EventSource` cannot attach this bearer header directly. Do not put tokens in URLs.

Errors use `{"error":{"code":"...","message":"..."}}`. Typical statuses: 400 malformed input, 401 invalid credential, 403 disabled source, 404 unknown scan/package, 409 scan not ready, 413 input budget, 422 unsupported input/action (including action bodies that fail schema validation, e.g. `max_changes` outside 1–100), 429 backpressure, 502 intelligence failure, 503 storage/readiness failure. Keep the `X-Request-ID` response header for support.

Limits: 12 MiB public scan body, 4 MiB and 500 source files, 5,000 package instances, 50,000 edges, two scan workers plus 18 queued jobs (20 admitted before `429 queue_full`), 16 event streams, 32 concurrent API requests. Scans have a five-minute budget; repository fetching has a 90-second budget. These are initial single-coordinator limits.

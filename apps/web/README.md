# Astra web

Next.js App Router client for investigation. Design: [design.md](./design.md). Backend contract: `../../docs/api.md`. Operator storage and restart rules: [../../README.md](../../README.md) (Operator runbook) and [../../docs/architecture.md](../../docs/architecture.md).

| How | URL | Core |
| --- | --- | --- |
| Compose `web` (operator stack) | `http://127.0.0.1:3000` | `http://core:8080` on the Compose network, PostgreSQL required |
| `make web` / `npm run dev` (laptop) | `http://127.0.0.1:3000` | `127.0.0.1:8080` (memory store unless that core has `DATABASE_URL`) |

```sh
cd apps/web
npm install
npm run dev
```

Optional `ASTRA_CORE_URL` and `ASTRA_API_TOKEN` in `apps/web/.env.local` for laptop runs. Compose injects both from the repo `.env`. The app proxies `/api/v1/*` so the browser never holds the service token. Do not put tokens in query strings.

GitHub intake in the UI still depends on core `ASTRA_ENABLE_GITHUB`; keep it false unless you accept the architecture limits. Remediate can upload a project ZIP for isolated verify; the file is not stored. Demo scans cannot be verified.

Voice: the magenta hold-to-talk control in the top bar needs microphone permission (browser prompt on first use) and `SARVAM_API_KEY` on the web server. Compose injects it from `.env`; for `make web`, put it in `apps/web/.env.local`. The key is proxied through `/api/voice/*` and never reaches the browser. Without it the control reports `sarvam_unconfigured`; Explain still returns its deterministic text.

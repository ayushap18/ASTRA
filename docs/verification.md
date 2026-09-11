# Backend verification — 2026-09-11

Executed on macOS arm64 using Go 1.26.1 and Python 3.14.5 with the checked-in Python lockfile.

| Check | Result |
| --- | --- |
| `go test -race ./...` | Passed; PostgreSQL-specific test runs separately against the temporary database |
| `go vet ./...` | Passed |
| Python `pytest -q` | 17 passed |
| Ruff lint and formatting | Checked with repository configuration |
| Real Go/Python API smoke | Passed |
| PostgreSQL interrupted-job recovery | Passed against temporary local PostgreSQL |
| PostgreSQL graph persistence across core restart | Passed |
| SSE event replay | Passed |
| Live npm + OSV enrichment | Passed for public `lodash@4.17.19` |
| Public GitHub repository ingestion | Passed for `zerodevapp/express-example`, `jsynowiec/node-typescript-boilerplate`, and `altcha-org/altcha-starter-nodejs-ts` |
| GitHub source import observation | Passed with 3 imported runtime packages and hashed `src/index.ts` locations from `altcha-org/altcha-starter-nodejs-ts` |
| Git fetch timeout handling | Passed: `fless-lab/node-ts-starter` exceeded the 90-second ingestion budget and produced a terminal `SCAN_FAILED` event |
| Graph and finding evidence integrity | Passed for the public GitHub scans inspected through the API |
| Sarvam payload boundary and timeout fallback | Passed with mocked provider; no live key configured |

The deterministic fixture produced six installed package instances, 12 findings, and three selected remediation proposals. The proposals remained explicitly unverified. The `zerodevapp/express-example` live scan resolved 111 package instances, 193 edges, 350 evidence records, and 17 findings; all 111 npm and OSV enrichments completed. It was marked partial because of five absent optional peer installations and because its source was outside the currently collected `src/`/`app/` paths. The `altcha-org/altcha-starter-nodejs-ts` scan completed without warnings and observed imports of `@hono/node-server`, `altcha-lib`, and `hono` from source evidence.

Two deprecation warnings originate in the locked Starlette test-client integration (httpx and BlockingPortal aliases). They did not fail tests. Docker is not installed in the development environment, so container image builds and Compose startup have not been executed. Live Sarvam was not exercised because no provider key is configured. The Next.js frontend has not been implemented, so `/` correctly returns 404 from the backend API.

The smoke runner stops its temporary service processes and removes its temporary database. It does not leave Astra running after tests.

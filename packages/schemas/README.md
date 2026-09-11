# Shared contracts

`graph.schema.json` and `intelligence.openapi.json` are generated from the Python Pydantic models with `make schemas`. The real Go-to-Python smoke test checks compatibility using the same contract. CI checks that generated contracts stay in sync.

Public gateway requests, responses, event behavior and authentication are documented in `../../docs/api.md`. Package `id` denotes an installed instance; `purl` denotes a package version. Clients should preserve this distinction.

# Analysis semantics

The graph is the shared evidence boundary. Go builds installed package instances and enriches facts; Python computes findings, risk, hypothetical propagation, and candidate fixes. Sarvam is an optional output interpreter. No AI output is consumed by the risk engine or optimizer.

## Identity and evidence

`purl` identifies a package version, such as `pkg:npm/%40scope/name@1.0.0`. `id` additionally identifies an installation path. Two copies of the same package/version can have different parents; collapsing them loses dependency resolution semantics. IDs are opaque to clients.

Every finding points to existing evidence. Evidence contains a source, a location when available, a SHA-256 hash when available, a summary, and confidence. Fixture records are labeled synthetic and must not be presented as real OSV advisories. Vulnerability snapshots can become stale: scan timestamps show when they were collected, and a fresh scan is required to update them.

The npm resolver implements the installed `packages` map and nested lookup from the [npm lockfile format](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json/). It does not execute npm or reconstruct a lockfile from an unpinned manifest. The provider adapter uses the [OSV exact-version query API](https://google.github.io/osv.dev/post-v1-query/) and follows pagination; failures are recorded as incomplete coverage.

## Risk v2

| Dimension | Weight | Current evidence |
| --- | ---: | --- |
| Vulnerability | 25% | Maximum normalized advisory severity; unknown severity uses 50 |
| Reachability | 20% | Level 0 unknown; legacy lexical observation 35; AST module reference 55; levels 3–4 reserved at 75/100 |
| Behavior | 15% | Static lifecycle presence and lexical capability observations |
| Maintainer | 10% | `60 × maintainer_changed + 40 × version_jump` (capped 100) when registry metadata is available or fixture; else unknown |
| Maintenance | 10% | `30 × major_gap + 10 × minor_gap + 40 × unmaintained` (capped 100) when registry metadata is available or fixture; else unknown |
| Concentration | 10% | Largest current shared-maintainer share of installed instances |
| License | 5% | Deny match 100; table conflict 80; weak-copyleft warning 40; unknown licence null |
| Centrality | 5% | Unique reverse dependency ancestors / possible ancestors |

An unknown dimension is `null`, not zero. The estimate uses a 50/100 prior for unknown dimensions. The lower bound substitutes zero for unknowns; the upper bound substitutes 100. A partially fetched OSV result retains the observed severity, widens its upper bound, and loses that dimension's coverage credit. Evidence confidence is observed weighted coverage multiplied by the mean confidence of linked evidence. These are transparent heuristics, not calibrated probabilities.

Repository risk is the maximum package estimate; trust is `100 - risk`. The empty graph has confidence zero. Do not interpret a trust number independently of coverage, confidence, warnings, and individual critical findings.

Reachability v2 parses JavaScript, JSX, TypeScript, and TSX with Tree-sitter and records file/line hashes for static imports, exports from another module, literal `require()`, and literal `import()`. Level 2 (`module_observed`) means only that parsed project source refers to the root-installed package instance. It does not prove that the source file, package, or an affected function executes. Relative paths, built-ins, computed specifiers, workspaces, bundler aliases, and nested-instance ownership are unresolved. Parser error recovery retains valid observations and emits a partial-evidence warning. A missing observation remains unknown; levels 3–4 and all dependency-edge execution flags remain reserved.

Risk model `risk-v2` keeps the level-2 value of 55. Reachability v2 activates that input with stronger syntactic evidence, but this remains a transparent heuristic rather than a calibrated execution probability. Historical level-1 `import_observed` snapshots remain valid inputs at 35.

Registry lifecycle commands are inspected for network, environment, shell, and filesystem syntax. This does not prove malicious intent. A command such as `node setup.js` is recorded as a lifecycle script, but the referenced file is not downloaded or analyzed in this increment.

## Detection per problem-statement goal

Every count in `summary.goals` is derived from findings or graph facts; a missing input stays unknown (null, -1, or an empty string) and produces no finding.

| Goal | Evidence used | Limits |
| --- | --- | --- |
| Dependency tree | Lockfile-installed instances, `direct`, `depth`, edges | npm only; unpinned manifests are not resolved |
| Vulnerabilities | OSV exact-version advisories plus reachability level | `reachable` means level ≥ 1 (a source reference), not proven execution; level 0 is counted as `unknown_reach` |
| Outdated | `major_gap`/`minor_gap`/`patch_gap` computed by core from installed vs. registry `latest_version` | `upgrade_effort` is a semver-distance estimate, not a build result; severity is high only when a major gap coincides with an advisory that lists a fixed version |
| Suspicious changes | `maintainer_changed`/`previous_maintainers` and `version_jump` from adjacent published versions; `lifecycle_capabilities` findings for install scripts | Maintainer change is observed between adjacent published versions only, not full ownership history; script capabilities are lexical |
| Licence conflict | `project_license` (root package.json) vs. dependency licence through an explicit SPDX table; caller deny list | Table: permissive project (MIT, ISC, BSD, Apache-2.0, 0BSD, Unlicense, CC0) vs. GPL-2.0/GPL-3.0/AGPL-3.0 is a conflict; LGPL is a warning under the dynamic-linking assumption; empty or unrecognised licences are unknown, never a conflict; `-only`/`-or-later` suffixes are normalised, SPDX expressions (`OR`, `AND`) are not evaluated. Not legal advice |
| Concentration | Maintainer appearing on the most installed instances and its share; `days_since_latest_publish ≥ 730` marks `unmaintained` | Current registry maintainers only; a quiet package is not necessarily abandoned |

## Experimental Astra Toxicity Radius

The implementation reports each factor and computes:

```text
centrality factor       = 1 + non-root ancestors / installed instances
observed import factor  = 1.5 if level >= 1, else 1
runtime privilege      = 1 (unknown, neutral assumption)
CI exposure factor     = 2 if scripts + CI install + scripts enabled, else 1
dependant factor       = 1 + log2(1 + ancestors including root)
script capability      = 1 + lexical capability count / 4 when a script exists
ATR                     = round(100 × (1 − exp(−product(factors) / 10)))
```

This is an experimental comparison heuristic under explicit assumptions. Propagation paths are cycle-safe and contain one shortest reverse dependency path per ancestor, not an enumeration of every possible path. No process, secret, deployment, or cloud account is touched by a simulation.

## Candidate remediation

The greedy optimizer prioritizes newly covered findings per cost, with deterministic tie-breaking and a maximum change budget. Cost is `1 + major-version penalty + direct/transitive effort penalty`. It considers stable exact fixed-version events newer than the installed version, plus the registry `latest_version` when newer: that candidate may address `outdated`, `license_conflict`, `maintainer_change`, and `version_jump` findings for the package, still as unverified candidates. An exact fixed event covers only the associated advisory; later versions are not presumed safe by version ordering alone. Pre-release handling and parent dependency solving are deliberately unresolved.

When the scan snapshot still has a lockfile, core applies `upgrade_direct_dependency` version bumps to a copy, re-parses installed instances, re-enriches, and re-analyzes without sources. `predicted_risk` is that summary risk. It is omitted (null) if the lockfile is missing, no direct upgrades exist, or the new version would add child packages. `POST /api/v1/scans/{id}/verify` may set `verified: true` only after a dedicated verifier runs `npm ci --ignore-scripts` and the project’s declared `test`/`build` scripts in an isolated container. That is evidence those checks passed, not that the patch is safe. Static scanning still never executes project commands. Demo fixtures cannot be verified.

## Interpreter boundary

The [Sarvam chat integration](https://docs.sarvam.ai/api-reference/chat/chat-completions) is opt-in and independent of analysis. Its fixed endpoint and configurable model receive a strict allowlist of structured numbers and enumerated finding kinds. Raw source, commands, repository URLs, maintainer identities, advisory prose, and freeform user queries are excluded from Explain. Generated text is labeled AI commentary and attached to the deterministic evidence IDs; it cannot modify a finding or score.

Voice ask (`apps/web` `/api/voice/ask`) is the one place a user utterance reaches Sarvam. The web server re-sanitizes it to at most 500 characters and sends it with a fact card limited to: scan id, status, and source; summary numbers; the selected package id, name, version, depth, and reachability level; finding kinds and severities; evidence ids; `verified`; and remediation status. Source text, commands, secrets, advisory prose, and maintainer identities are still excluded. Action routing (list, open, start, simulate, remediate, verify) is deterministic in `apps/web/lib/voice/commands.ts` and runs before any model call; Sarvam never selects or performs an action.

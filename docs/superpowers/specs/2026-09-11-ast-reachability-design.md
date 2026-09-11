# AST reachability v2

## Goal

Replace regex-based npm import detection with deterministic Tree-sitter parsing for JavaScript and TypeScript source. Eliminate false observations from comments and strings while preserving Astra's evidence and uncertainty rules.

## Supported input

Parse project files ending in `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, or `.cts`.

Recognize npm package references from:

- static `import` declarations;
- `export ... from` declarations;
- literal `require("package")` calls;
- literal `import("package")` calls.

Ignore relative and absolute paths, `node:` built-ins, non-literal/computed calls, unsupported extensions, and content under `node_modules`.

Bare and subpath specifiers map to the root-installed instance at `node_modules/<name>`. Scoped package names retain the first two path components. Source analysis must not infer a nested install instance without evidence that the source file belongs to that package.

## Reachability semantics

An AST-confirmed package reference sets the matched package to level 2 with status `module_observed`. This means a supported project source file contains parsed module syntax referring to that package. It does not prove the source file executes, the dependency executes, or an affected function is called.

Levels 3 (`function_observed`) and 4 (`reachable`) remain reserved. Dependency edges remain `reachable: false`; install ancestry is not an execution path.

## Evidence

Each unique file, source line, and install-instance tuple produces one deterministic evidence ID. Evidence records:

- kind `module_reference`;
- source `static-ast-v2`;
- `file:line` location;
- SHA-256 of the complete source file;
- a summary that names the package and explicitly says execution is unproven;
- confidence below 1 because AST syntax alone does not establish runtime execution.

Repeated analysis must not duplicate evidence IDs or package evidence references. Externally visible ordering remains deterministic.

## Failure and partial-result behavior

Tree-sitter error recovery may retain valid references surrounding malformed syntax. If a supported file contains parser error nodes, append a deterministic graph warning that its AST evidence may be partial. A parse failure must not become proof of absence or lower an existing reachability level.

Unsupported files are skipped. No analyzed source or project command is executed. Raw source is not persisted by this change.

## Components

- `app/reachability/engine.py`: file selection, parser dispatch, AST traversal, package matching, evidence creation.
- Python project and lock/export files: pinned Tree-sitter runtime and JavaScript/TypeScript grammars.
- `tests/test_reachability.py`: focused JS/JSX/TS/TSX and uncertainty regression tests.
- Existing analysis/docs/contracts: update reachability wording; the wire schema does not change.

## Testing

Tests cover all supported reference forms and source extensions, comments/string false positives, computed expressions, relative/builtin imports, scoped and subpath names, root-vs-nested instance identity, malformed-source warnings, duplicate evidence prevention, deterministic ordering, unchanged edges, and reserved levels 3–4.

Run targeted reachability tests, all Python tests, Ruff checks/format checks, regenerate dependency exports after lock changes, and run the service smoke test because Go sends source maps to the Python endpoint.

## Explicit non-goals

- module resolution across project files or workspaces;
- control-flow, entrypoint, bundler, framework, or runtime analysis;
- affected-symbol or affected-function matching;
- raising levels 3–4;
- executing package managers, lifecycle scripts, builds, or analyzed project code.

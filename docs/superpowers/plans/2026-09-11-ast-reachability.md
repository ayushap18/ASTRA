# AST Reachability v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace regex import candidates with deterministic JavaScript/TypeScript AST module-reference evidence while keeping runtime execution unknown.

**Architecture:** The intelligence service selects supported source extensions, parses each file with the matching Tree-sitter grammar, and traverses syntax nodes for supported module references. It maps only root project imports to root-installed npm instances, emits deterministic evidence, warns on parser error recovery, and never marks dependency edges reachable.

**Tech Stack:** Python 3.12+, Tree-sitter Python bindings, tree-sitter-javascript, tree-sitter-typescript, Pydantic, pytest, Ruff, uv.

## Global Constraints

- Parse `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, and `.cts`.
- Recognize static imports, `export ... from`, literal `require()`, and literal `import()`.
- Ignore relative/absolute/builtin/computed references and files below `node_modules`.
- Preserve package installation-instance identity; map project sources only to `node_modules/<name>`.
- Level 2 means parsed module reference only. Levels 3–4 remain reserved and all edges remain unreachable.
- Evidence contains a source-file hash and location, never raw source.
- Parser errors retain partial observations and add deterministic warnings.
- Never execute analyzed source, package managers, lifecycle scripts, builds, or project commands.

---

### Task 1: Lock Tree-sitter dependencies

**Files:**
- Modify: `services/intelligence/pyproject.toml`
- Modify: `services/intelligence/uv.lock`
- Modify: `services/intelligence/requirements.lock`

**Interfaces:**
- Produces: importable `tree_sitter`, `tree_sitter_javascript`, and `tree_sitter_typescript` packages.

- [ ] Add all three runtime dependencies with `uv add tree-sitter tree-sitter-javascript tree-sitter-typescript`.
- [ ] Export the production requirements with `uv export --frozen --no-dev --no-emit-project -o requirements.lock`.
- [ ] Verify imports using `.venv/bin/python -c "import tree_sitter, tree_sitter_javascript, tree_sitter_typescript"`.

### Task 2: AST module-reference extraction

**Files:**
- Create: `services/intelligence/tests/test_reachability.py`
- Modify: `services/intelligence/app/reachability/engine.py`
- Modify: `services/intelligence/tests/test_analysis.py`

**Interfaces:**
- Consumes: `inspect_sources(graph: Graph, sources: dict[str, str]) -> Graph`.
- Produces: level-2 `module_observed` package state and `module_reference` evidence from supported AST nodes.

- [ ] Write failing parameterized tests for all supported extensions and reference forms. Assert `static-ast-v2`, level 2, `module_observed`, file/line hash evidence, and unchanged edges.
- [ ] Run `.venv/bin/python -m pytest tests/test_reachability.py -q` and confirm failure because regex evidence is level 1 and cannot parse all forms safely.
- [ ] Add parser selection for JavaScript, JSX, TypeScript, and TSX grammars.
- [ ] Add deterministic AST traversal for import/export source fields and literal `require()`/`import()` call arguments.
- [ ] Add npm specifier normalization and root-instance lookup without nested-instance inference.
- [ ] Emit one evidence record per file/line/instance tuple, preserving existing evidence and reachability levels.
- [ ] Update the old lexical test to assert AST v2 semantics.
- [ ] Run targeted tests and confirm they pass.

### Task 3: Uncertainty and integrity regressions

**Files:**
- Modify: `services/intelligence/tests/test_reachability.py`
- Modify: `services/intelligence/app/reachability/engine.py`

**Interfaces:**
- Produces: deterministic partial-result warnings and idempotent evidence output.

- [ ] Write failing tests proving comments, ordinary strings, computed imports, relative paths, and `node:` built-ins do not create evidence.
- [ ] Write failing tests for scoped/subpath matching, nested-instance non-inference, malformed-source warnings, repeated-call idempotence, stable ordering, unchanged level 3–4 state, and unchanged edges.
- [ ] Run the focused tests and confirm failures correspond to missing behavior.
- [ ] Implement parser-error warnings and deterministic deduplication/order without interpreting missing evidence as unreachable.
- [ ] Run all focused tests and confirm they pass.

### Task 4: Align semantics and verify the service

**Files:**
- Modify: `docs/analysis.md`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-09-11-astra-workbench-production.md`

**Interfaces:**
- Documents: AST level-2 meaning, parser limitations, and reserved levels.

- [ ] Replace lexical-v1 wording with AST-v2 syntax and limitations.
- [ ] Run `.venv/bin/ruff format --check app tests ../../scripts` and `.venv/bin/ruff check app tests ../../scripts`.
- [ ] Run `.venv/bin/python -m pytest -q`.
- [ ] Run `make smoke` from the repository root to verify the Go-to-Python source-map flow.
- [ ] Confirm generated schemas are unchanged because no wire model changed.
- [ ] Mark Task 5 complete in the sequential production plan.

No commit steps are included because `/Users/ayush18/muj` is not a Git repository.

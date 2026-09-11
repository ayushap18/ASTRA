import hashlib

import pytest

from app.models import Package
from app.reachability.engine import inspect_sources


@pytest.mark.parametrize(
    ("file", "source"),
    [
        ("src/a.js", "import client from 'client';"),
        ("src/a.jsx", "export { default } from 'client/subpath';"),
        ("src/a.mjs", "const client = require('client');"),
        ("src/a.cjs", "const client = require('client/subpath');"),
        ("src/a.ts", "const client: unknown = require('client');"),
        ("src/a.tsx", "const Client = () => import('client');"),
        ("src/a.mts", "import type { Client } from 'client';"),
        ("src/a.cts", "export * from 'client';"),
        ("src/import-equals.ts", "import client = require('client');"),
    ],
)
def test_supported_javascript_typescript_references_are_ast_evidence(graph, file, source):
    result = inspect_sources(graph, {file: source})

    package = result.packages[0]
    assert package.reachability.level == 2
    assert package.reachability.status == "module_observed"
    evidence = next(e for e in result.evidence if e.kind == "module_reference")
    assert evidence.source == "static-ast-v2"
    assert evidence.location == f"{file}:1"
    assert evidence.sha256 == hashlib.sha256(source.encode()).hexdigest()
    assert "execution" in evidence.summary.lower()
    assert not any(edge.reachable for edge in result.edges)


def test_comments_strings_computed_and_local_references_are_not_observations(graph):
    source = """
// import client from "client"
const example = "require('client')";
require(name);
import(`client/${name}`);
import "./client";
import "node:fs";
"""
    result = inspect_sources(graph, {"src/a.ts": source, "README.md": "import client from 'client'"})

    assert not [e for e in result.evidence if e.source == "static-ast-v2"]
    assert result.packages[0].reachability.level == 0


@pytest.mark.parametrize(
    "source",
    [
        "require(/* package */ 'client');",
        "import(/* webpackChunkName: 'client' */ 'client');",
        "import('client', { with: { type: 'json' } });",
    ],
)
def test_comments_and_attributes_do_not_hide_literal_module_references(graph, source):
    result = inspect_sources(graph, {"src/a.js": source})

    assert result.packages[0].reachability.level == 2
    assert len([e for e in result.evidence if e.source == "static-ast-v2"]) == 1


def test_sources_below_node_modules_are_not_project_observations(graph):
    result = inspect_sources(graph, {"node_modules/tool/index.js": "import 'client';"})

    assert result.packages[0].reachability.level == 0
    assert not [e for e in result.evidence if e.source == "static-ast-v2"]


def test_scoped_subpath_maps_only_to_root_install_instance(graph):
    root = graph.packages[0]
    root.name = "@scope/client"
    root.install_path = "node_modules/@scope/client"
    nested = Package.model_validate(
        {
            **root.model_dump(),
            "id": "nested-client",
            "install_path": "node_modules/parser/node_modules/@scope/client",
            "reachability": {"level": 0, "status": "unknown", "evidence_ids": ["ev:client"]},
        }
    )
    graph.packages.append(nested)

    inspect_sources(graph, {"src/a.ts": "import '@scope/client/feature';"})

    assert root.reachability.level == 2
    assert nested.reachability.level == 0


def test_malformed_source_retains_partial_ast_evidence_and_warns(graph):
    source = "import 'client';\nfunction broken("
    result = inspect_sources(graph, {"src/broken.js": source})

    assert result.packages[0].reachability.level == 2
    assert any("src/broken.js" in warning and "partial" in warning for warning in result.warnings)


def test_repeated_analysis_is_idempotent_and_deterministic(graph):
    sources = {"src/z.js": "import 'client';", "src/a.js": "require('client');"}
    first = inspect_sources(graph, sources)
    reference_count = len(first.packages[0].reachability.evidence_ids)
    second = inspect_sources(first, sources)
    observations = [e for e in second.evidence if e.source == "static-ast-v2"]

    assert [e.location for e in observations] == ["src/a.js:1", "src/z.js:1"]
    assert len(observations) == 2
    assert len(second.packages[0].reachability.evidence_ids) == reference_count


@pytest.mark.parametrize(("level", "status"), [(3, "function_observed"), (4, "reachable")])
def test_ast_observation_never_lowers_stronger_reachability(graph, level, status):
    package = graph.packages[0]
    package.reachability.level = level
    package.reachability.status = status

    result = inspect_sources(graph, {"src/a.js": "import 'client';"})

    assert result.packages[0].reachability.level == level
    assert result.packages[0].reachability.status == status
    assert not any(edge.reachable for edge in result.edges)

import pytest
from pydantic import ValidationError

from app.models import Edge, Graph, Script, SimulationRequest, Vulnerability
from app.reachability.engine import inspect_sources
from app.risk.engine import WEIGHTS, analyze
from app.risk.simulation import simulate


def test_deterministic_scores_and_unknown_bounds(graph):
    result = analyze(graph, [])
    assert result == analyze(graph, [])
    assert sum(WEIGHTS.values()) == pytest.approx(1)
    for risk in result["risks"].values():
        assert 0 <= risk["lower_bound"] <= risk["score"] <= risk["upper_bound"] <= 100
        assert risk["dimensions"]["reachability"] is None
        assert risk["confidence"] < 100
    assert result["summary"]["execution_proven"] == 0


def test_provider_outage_does_not_become_clean(graph):
    before = analyze(graph, [])["risks"]["client"]
    graph.packages[0].metadata.osv_status = "unavailable"
    after = analyze(graph, [])["risks"]["client"]
    assert after["dimensions"]["vulnerability"] is None
    assert after["confidence"] < before["confidence"]
    assert after["upper_bound"] > before["upper_bound"]


def test_ast_module_references_never_prove_execution_or_transitive_reachability(graph):
    result = inspect_sources(graph, {"src/api.ts": "import client from 'client';\n// require('helper')\n"})
    assert result.packages[0].reachability.level == 2
    assert result.packages[0].reachability.status == "module_observed"
    assert result.packages[1].reachability.level == 0
    assert result.packages[2].reachability.status == "unknown"
    assert not any(e.reachable for e in result.edges)
    evidence = next(e for e in result.evidence if e.kind == "module_reference")
    assert evidence.location == "src/api.ts:1" and len(evidence.sha256) == 64
    assert "import client" not in evidence.model_dump_json()
    risk = analyze(result, [])["risks"]["client"]
    assert risk["model_version"] == "risk-v2"
    assert risk["dimensions"]["reachability"] == 55


def test_simulation_is_conditional_and_traversal_is_cycle_safe(graph):
    graph.edges.append(
        Edge(source="helper", target="client", scope="runtime", requirement="1", reachable=False)
    )
    helper = graph.packages[2]
    helper.install_scripts = [
        Script(name="postinstall", capabilities=["shell", "network"], evidence_id="ev:helper")
    ]
    base = simulate(
        SimulationRequest(graph=graph, package_id="helper", credential_categories=["repository_token"])
    )
    assert base["propagation"] == []
    assert base["secret_exposure_potential"]["repository_token"] == "unknown"
    exposed = simulate(
        SimulationRequest(
            graph=graph,
            package_id="helper",
            ci_install=True,
            lifecycle_scripts_enabled=True,
            credential_categories=["repository_token"],
        )
    )
    assert exposed["toxicity_radius"] > base["toxicity_radius"]
    assert exposed["secret_exposure_potential"]["repository_token"] == "high"
    assert set(exposed["affected_packages"]) == {"client", "parser"}
    assert "secret_values" not in exposed


def test_all_findings_link_existing_evidence(graph):
    graph.packages[0].vulnerabilities = [
        Vulnerability(
            id="TEST", summary="test", severity="critical", fixed_versions=["1.0.1"], evidence_id="ev:client"
        )
    ]
    result = analyze(graph, ["MIT"])
    ids = {e.id for e in graph.evidence}
    assert result["findings"]
    for finding in result["findings"]:
        assert finding["evidence_ids"] and set(finding["evidence_ids"]) <= ids


def test_partial_osv_results_retain_observed_severity(graph):
    graph.packages[0].vulnerabilities = [
        Vulnerability(id="TEST", summary="test", severity="high", fixed_versions=[], evidence_id="ev:client")
    ]
    complete = analyze(graph, [])["risks"]["client"]
    graph.packages[0].metadata.osv_status = "unavailable"
    partial = analyze(graph, [])["risks"]["client"]
    assert partial["dimensions"]["vulnerability"] == 80
    assert partial["confidence"] < complete["confidence"]
    assert partial["upper_bound"] > complete["upper_bound"]


@pytest.mark.parametrize("mutation", ["edge", "evidence", "duplicate"])
def test_graph_rejects_invalid_references(graph, mutation):
    data = graph.model_dump()
    if mutation == "edge":
        data["edges"][0]["target"] = "missing"
    elif mutation == "evidence":
        data["packages"][0]["evidence_ids"] = ["missing"]
    else:
        data["packages"].append(data["packages"][0])
    with pytest.raises(ValidationError):
        Graph.model_validate(data)

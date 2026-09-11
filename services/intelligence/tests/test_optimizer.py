from app.models import RemediationRequest, Vulnerability
from app.optimizer.engine import plan


def advisory(id, fixes):
    return Vulnerability(id=id, summary=id, severity="high", fixed_versions=fixes, evidence_id="ev:client")


def test_optimizer_covers_exact_fixed_events_and_never_claims_verified(graph):
    graph.packages[0].vulnerabilities = [
        advisory("A", ["1.0.1"]),
        advisory("B", ["1.0.1"]),
        advisory("C", ["2.0.0"]),
    ]
    result = plan(RemediationRequest(graph=graph))
    assert len(result["changes"]) == 1
    assert result["changes"][0]["to"] == "1.0.1"
    assert result["potentially_addressed_findings"] == 2
    assert result["predicted_risk"] is None and not result["verified"]
    assert result == plan(RemediationRequest(graph=graph))


def test_no_unsafe_prerelease_or_downgrade_candidates(graph):
    graph.packages[0].vulnerabilities = [advisory("A", ["0.9.0", "1.0.0", "1.1.0-beta.1"])]
    assert plan(RemediationRequest(graph=graph))["changes"] == []


def test_transitive_change_requires_parent_investigation(graph):
    graph.packages[1].vulnerabilities = [
        Vulnerability(
            id="B", summary="b", severity="critical", fixed_versions=["1.0.2"], evidence_id="ev:parser"
        )
    ]
    change = plan(RemediationRequest(graph=graph))["changes"][0]
    assert change["action"] == "investigate_parent_upgrade"
    assert change["breaking_risk"] == "unknown"

import pytest

from app.models import Graph, RemediationRequest, Script, Vulnerability
from app.optimizer.engine import plan
from app.risk.engine import analyze, license_compat


def kinds(result, package_id):
    return {f["kind"]: f for f in result["findings"] if f["package_id"] == package_id}


def test_old_payloads_validate_and_missing_metadata_stays_unknown(graph):
    data = graph.model_dump()
    for p in data["packages"]:
        for key in list(p["metadata"]):
            if key not in {"registry_status", "osv_status", "maintainers", "has_install_script"}:
                del p["metadata"][key]
        p["metadata"]["registry_status"] = "unavailable"
    del data["project_license"]
    result = analyze(Graph.model_validate(data), [])
    for risk in result["risks"].values():
        assert risk["dimensions"]["maintenance"] is None
        assert risk["dimensions"]["maintainer"] is None
    assert {f["kind"] for f in result["findings"]} == {"maintainer_concentration"}
    goals = result["summary"]["goals"]
    assert goals["outdated"]["total"] == 0 and goals["suspicious"]["maintainer_changes"] == 0
    assert goals["license"] == {"conflicts": 0, "denied": 0, "unknown": 0}


def test_current_package_with_registry_evidence_scores_zero_not_none(graph):
    risk = analyze(graph, [])["risks"]["client"]
    assert risk["dimensions"]["maintenance"] == 0 and risk["dimensions"]["maintainer"] == 0
    assert risk["model_version"] == "risk-v2"


def test_outdated_severity_and_effort(graph):
    client, parser, helper = graph.packages
    client.metadata.major_gap, client.metadata.latest_version = 2, "3.0.0"
    parser.metadata.major_gap, parser.metadata.latest_version = 1, "2.0.0"
    parser.vulnerabilities = [
        Vulnerability(id="A", summary="a", severity="high", fixed_versions=["2.0.0"], evidence_id="ev:parser")
    ]
    helper.metadata.patch_gap, helper.metadata.latest_version = 3, "1.0.3"
    result = analyze(graph, [])
    client_f, parser_f, helper_f = (kinds(result, p)["outdated"] for p in ("client", "parser", "helper"))
    assert client_f["severity"] == "medium" and client_f["upgrade_effort"] == "major"
    assert client_f["upgrade_note"] == "2 major(s) behind; expect breaking changes"
    assert parser_f["severity"] == "high"
    assert helper_f["severity"] == "low" and helper_f["upgrade_effort"] == "patch"
    assert result["summary"]["goals"]["outdated"] == {"total": 3, "major": 2, "minor": 0, "patch": 1}
    assert result["risks"]["client"]["dimensions"]["maintenance"] == 60


def test_suspicious_and_unmaintained_findings(graph):
    client = graph.packages[0]
    client.metadata.maintainer_changed = True
    client.metadata.previous_maintainers = ["old"]
    client.metadata.version_jump = True
    client.metadata.version_jump_note = "1.0.0 -> 9.0.0"
    client.metadata.days_since_latest_publish = 800
    client.install_scripts = [Script(name="postinstall", capabilities=["shell"], evidence_id="ev:client")]
    result = analyze(graph, [])
    found = kinds(result, "client")
    assert found["maintainer_change"]["severity"] == "medium"
    assert found["maintainer_change"]["previous_maintainers"] == ["old"]
    assert found["version_jump"]["title"] == "1.0.0 -> 9.0.0"
    assert found["unmaintained"]["severity"] == "medium"
    assert result["risks"]["client"]["dimensions"]["maintainer"] == 100
    goals = result["summary"]["goals"]
    assert goals["suspicious"] == {"maintainer_changes": 1, "version_jumps": 1, "install_scripts": 1}
    assert goals["concentration"] == {
        "top_maintainer": "owner",
        "top_maintainer_share": 1.0,
        "unmaintained": 1,
    }
    ids = {e.id for e in graph.evidence}
    assert all(f["evidence_ids"] and set(f["evidence_ids"]) <= ids for f in result["findings"])


def test_unmaintained_threshold_is_exact(graph):
    graph.packages[0].metadata.days_since_latest_publish = 729
    assert "unmaintained" not in kinds(analyze(graph, []), "client")


@pytest.mark.parametrize(
    "project,dependency,expected",
    [
        ("MIT", "GPL-3.0", "conflict"),
        ("Apache-2.0", "GPL-2.0-only", "conflict"),
        ("ISC", "AGPL-3.0-or-later", "conflict"),
        ("MIT", "LGPL-2.1", "warning"),
        ("MIT", "MIT", "ok"),
        ("GPL-3.0", "GPL-3.0", "ok"),
        ("", "GPL-3.0", "unknown"),
        ("MIT", "", "unknown"),
    ],
)
def test_license_table(project, dependency, expected):
    assert license_compat(project, dependency) == expected


def test_license_conflict_findings_and_goal_counts(graph):
    graph.project_license = "MIT"
    graph.packages[0].license = "GPL-3.0"
    graph.packages[1].license = ""
    graph.packages[2].license = "Apache-2.0"
    result = analyze(graph, ["Apache-2.0"])
    assert kinds(result, "client")["license_conflict"]["reason"] == "incompatible"
    assert kinds(result, "helper")["license_conflict"]["reason"] == "denied"
    assert "license_conflict" not in kinds(result, "parser")
    assert result["risks"]["parser"]["dimensions"]["license"] is None
    assert result["summary"]["goals"]["license"] == {"conflicts": 1, "denied": 1, "unknown": 1}


def test_tree_and_vulnerability_goal_counts(graph):
    graph.packages[1].vulnerabilities = [
        Vulnerability(id="A", summary="a", severity="high", fixed_versions=[], evidence_id="ev:parser")
    ]
    goals = analyze(graph, [])["summary"]["goals"]
    assert goals["tree"] == {"direct": 1, "transitive": 2, "max_depth": 2}
    assert goals["vulnerabilities"] == {"total": 1, "reachable": 0, "unknown_reach": 1}


def test_remediation_targets_latest_for_outdated_and_suspicious(graph):
    client = graph.packages[0]
    client.metadata.major_gap, client.metadata.latest_version = 1, "2.0.0"
    client.metadata.maintainer_changed = True
    result = plan(RemediationRequest(graph=graph))
    assert len(result["changes"]) == 1
    change = result["changes"][0]
    assert change["to"] == "2.0.0" and change["major_change"] and not change["verified"]
    assert len(change["finding_ids"]) == 2 and change["evidence_ids"] == ["ev:client"]
    assert result["potentially_addressed_findings"] == 2

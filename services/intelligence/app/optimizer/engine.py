import re

from app.models import RemediationRequest
from app.risk.engine import analyze

VERSION = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
# Findings a move to the current release can plausibly address; still candidates, never verified.
UPGRADABLE = {"outdated", "license_conflict", "maintainer_change", "version_jump"}


def stable_version(value: str):
    match = VERSION.fullmatch(value)
    return tuple(map(int, match.groups())) if match else None


def plan(request: RemediationRequest) -> dict:
    analysis = analyze(request.graph, request.denied_licenses)
    candidates = []
    for package in request.graph.packages:
        current = stable_version(package.version)
        if current is None:
            continue
        versions = {
            v
            for advisory in package.vulnerabilities
            for v in advisory.fixed_versions
            if stable_version(v) is not None and stable_version(v) > current
        }
        latest = package.metadata.latest_version
        if stable_version(latest) is not None and stable_version(latest) > current:
            versions.add(latest)
        for version in sorted(versions, key=stable_version):
            # Exact fixed events only. A later version is not assumed to fix every earlier advisory.
            advisory_ids = {v.id for v in package.vulnerabilities if version in v.fixed_versions}
            covers = {
                f["id"]
                for f in analysis["findings"]
                if f["package_id"] == package.id
                and (f["advisory_id"] in advisory_ids or (version == latest and f["kind"] in UPGRADABLE))
            }
            if not covers:
                continue
            breaking = 5 if stable_version(version)[0] != current[0] else 1
            effort = 1 if package.direct else 3
            candidates.append(
                {
                    "package_id": package.id,
                    "package": package.name,
                    "from": package.version,
                    "to": version,
                    "finding_ids": sorted(covers),
                    "cost": 1 + breaking + effort,
                    "breaking_risk": "unknown",
                    "major_change": breaking == 5,
                    "action": "upgrade_direct_dependency" if package.direct else "investigate_parent_upgrade",
                    "evidence_ids": sorted(
                        {e for f in analysis["findings"] if f["id"] in covers for e in f["evidence_ids"]}
                    ),
                    "verified": False,
                }
            )
    selected, covered, changed = [], set(), set()
    while len(selected) < request.max_changes:
        eligible = [
            c for c in candidates if c["package_id"] not in changed and set(c["finding_ids"]) - covered
        ]
        if not eligible:
            break
        best = sorted(
            eligible,
            key=lambda c: (
                -len(set(c["finding_ids"]) - covered) / c["cost"],
                c["package_id"],
                stable_version(c["to"]),
            ),
        )[0]
        selected.append(best)
        covered.update(best["finding_ids"])
        changed.add(best["package_id"])
    return {
        "status": "proposal",
        "algorithm": "deterministic-greedy-set-cover-v2",
        "changes": selected,
        "current_risk": analysis["summary"]["risk"],
        "potentially_addressed_findings": len(covered),
        "total_findings": len(analysis["findings"]),
        "remaining_finding_ids": [f["id"] for f in analysis["findings"] if f["id"] not in covered],
        "verified": False,
        "predicted_risk": None,
        "verification_required": [
            "Resolve the new lockfile without running lifecycle scripts.",
            "Re-query all resolved versions against OSV and compare the graph.",
            "Run application tests and build in an isolated environment.",
        ],
        "limitations": [
            "OSV fixed events are candidates, not a verified safe version recommendation.",
            "Transitive changes require a compatible parent upgrade; no blind overrides are generated.",
            "No generated lockfile, build probability, or migration-time claim without validation.",
        ],
    }

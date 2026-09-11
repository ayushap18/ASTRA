import hashlib
from collections import Counter, defaultdict, deque

from app.models import Graph

WEIGHTS = {
    "vulnerability": 0.25,
    "reachability": 0.20,
    "behaviour": 0.15,
    "maintainer": 0.10,
    "maintenance": 0.10,
    "concentration": 0.10,
    "license": 0.05,
    "centrality": 0.05,
}
SEVERITY = {"critical": 100, "high": 80, "medium": 50, "low": 20, "unknown": 50}
UNMAINTAINED_DAYS = 730
PERMISSIVE = {
    "MIT",
    "ISC",
    "BSD",
    "BSD-2-CLAUSE",
    "BSD-3-CLAUSE",
    "APACHE-2.0",
    "0BSD",
    "UNLICENSE",
    "CC0-1.0",
}
COPYLEFT = {"GPL-2.0", "GPL-3.0", "AGPL-3.0"}
WEAK_COPYLEFT = {"LGPL-2.0", "LGPL-2.1", "LGPL-3.0"}


def spdx(value: str) -> str:
    return value.strip().upper().removesuffix("-ONLY").removesuffix("-OR-LATER").removesuffix("+")


def license_compat(project: str, dependency: str) -> str:
    """Explicit table: ok | warning | conflict | unknown. Unknown is never a conflict."""
    project, dependency = spdx(project), spdx(dependency)
    if not project or not dependency:
        return "unknown"
    if dependency in WEAK_COPYLEFT:
        return "warning"  # assumes dynamic linking; static bundling is not checked
    if project in PERMISSIVE and dependency in COPYLEFT:
        return "conflict"
    return "ok"


def walk(start: str, adjacency: dict[str, set[str]]) -> set[str]:
    seen, queue = {start}, deque([start])
    while queue:
        for target in adjacency.get(queue.popleft(), ()):
            if target not in seen:
                seen.add(target)
                queue.append(target)
    return seen - {start}


def topology(graph: Graph):
    forward, reverse = defaultdict(set), defaultdict(set)
    for edge in graph.edges:
        forward[edge.source].add(edge.target)
        reverse[edge.target].add(edge.source)
    return forward, reverse


def analyze(graph: Graph, denied_licenses: list[str]) -> dict:
    _, reverse = topology(graph)
    owners = Counter(owner for p in graph.packages for owner in set(p.metadata.maintainers))
    evidence = {e.id: e for e in graph.evidence}
    risks, findings = {}, []
    for package in sorted(graph.packages, key=lambda p: p.id):
        ancestors = walk(package.id, reverse) - {graph.root_id}
        capabilities = {c for s in package.install_scripts for c in s.capabilities}
        meta = package.metadata
        registry = meta.registry_status in {"available", "fixture"}
        unmaintained = meta.days_since_latest_publish >= UNMAINTAINED_DAYS
        compat = license_compat(graph.project_license, package.license)
        registry_refs = [
            r for r in package.evidence_ids if evidence[r].kind == "registry_metadata"
        ] or package.evidence_ids
        # Missing data stays unknown. The point estimate uses a documented 50/100 prior.
        dimensions: dict[str, float | None] = {
            "vulnerability": (
                max((SEVERITY[v.severity] for v in package.vulnerabilities), default=0)
                if package.vulnerabilities or package.metadata.osv_status in {"available", "fixture"}
                else None
            ),
            "reachability": {0: None, 1: 35, 2: 55, 3: 75, 4: 100}[package.reachability.level],
            "behaviour": (
                min(100, 20 + 20 * len(capabilities))
                if package.install_scripts
                else (
                    30
                    if package.metadata.has_install_script
                    else (0 if package.metadata.registry_status in {"available", "fixture"} else None)
                )
            ),
            "maintainer": (
                min(100, 60 * meta.maintainer_changed + 40 * meta.version_jump) if registry else None
            ),
            "maintenance": (
                min(100, 30 * meta.major_gap + 10 * meta.minor_gap + 40 * unmaintained) if registry else None
            ),
            "concentration": (
                round(
                    100 * max(owners[o] for o in package.metadata.maintainers) / max(1, len(graph.packages))
                )
                if package.metadata.maintainers
                else None
            ),
            "license": (
                100
                if package.license in denied_licenses
                else {"conflict": 80, "warning": 40, "ok": 0, "unknown": None}[compat]
            ),
            "centrality": round(100 * len(ancestors) / max(1, len(graph.packages) - 1)),
        }
        known = sum(WEIGHTS[k] for k, v in dimensions.items() if v is not None)
        lower = sum(WEIGHTS[k] * v for k, v in dimensions.items() if v is not None)
        score = round(lower + (1 - known) * 50)
        refs = list(
            dict.fromkeys(
                package.evidence_ids
                + package.reachability.evidence_ids
                + [v.evidence_id for v in package.vulnerabilities]
                + [s.evidence_id for s in package.install_scripts]
            )
        )
        # A partially fetched advisory set still establishes a lower-bound severity, but not full coverage.
        coverage = known - (
            WEIGHTS["vulnerability"]
            if package.vulnerabilities and package.metadata.osv_status not in {"available", "fixture"}
            else 0
        )
        confidence = round(100 * coverage * (sum(evidence[r].confidence for r in refs) / max(1, len(refs))))
        upper = lower + (1 - known) * 100
        if package.vulnerabilities and package.metadata.osv_status not in {"available", "fixture"}:
            upper += WEIGHTS["vulnerability"] * (100 - dimensions["vulnerability"])
        risks[package.id] = {
            "score": score,
            "confidence": confidence,
            "dimensions": dimensions,
            "lower_bound": round(lower),
            "upper_bound": round(upper),
            "evidence_ids": refs,
            "model_version": "risk-v2",
        }

        def finding(kind, title, severity, refs, advisory_id=None, **extra):
            fid = (
                "finding:"
                + hashlib.sha256(f"{package.id}:{kind}:{advisory_id or title}".encode()).hexdigest()[:20]
            )
            findings.append(
                {
                    "id": fid,
                    "package_id": package.id,
                    "kind": kind,
                    "title": title,
                    "severity": severity,
                    "evidence_ids": refs,
                    "advisory_id": advisory_id,
                    "reachability": package.reachability.model_dump(),
                    **extra,
                }
            )

        for vulnerability in package.vulnerabilities:
            finding(
                "vulnerability",
                vulnerability.summary,
                vulnerability.severity,
                [vulnerability.evidence_id, *package.reachability.evidence_ids],
                vulnerability.id,
            )
        if capabilities:
            finding(
                "lifecycle_capabilities",
                "Lifecycle script has statically observed capabilities: " + ", ".join(sorted(capabilities)),
                "high" if len(capabilities) >= 2 else "medium",
                [s.evidence_id for s in package.install_scripts],
            )
        elif package.metadata.has_install_script:
            finding(
                "lifecycle_script",
                "Install script present; capabilities not established",
                "unknown",
                package.evidence_ids,
            )
        if package.license in denied_licenses:
            finding(
                "license_conflict",
                f"License {package.license} matches the configured deny policy",
                "high",
                package.evidence_ids,
                reason="denied",
            )
        elif compat == "conflict":
            finding(
                "license_conflict",
                f"{package.license} is incompatible with project licence {graph.project_license}",
                "high",
                package.evidence_ids,
                reason="incompatible",
            )
        elif compat == "warning":
            finding(
                "license_conflict",
                f"{package.license} is compatible only under the dynamic linking assumption",
                "low",
                package.evidence_ids,
                reason="weak_copyleft",
            )
        if registry and (meta.major_gap or meta.minor_gap or meta.patch_gap):
            effort = "major" if meta.major_gap else "minor" if meta.minor_gap else "patch"
            fixable = any(v.fixed_versions for v in package.vulnerabilities)
            note = {
                "major": f"{meta.major_gap} major(s) behind; expect breaking changes",
                "minor": f"{meta.minor_gap} minor(s) behind; additive changes expected",
                "patch": f"{meta.patch_gap} patch(es) behind; fixes only expected",
            }[effort]
            finding(
                "outdated",
                f"Installed {package.version}, latest {meta.latest_version}",
                ("high" if fixable else "medium") if effort == "major" else "low",
                registry_refs,
                upgrade_effort=effort,
                upgrade_note=note,
            )
        if meta.maintainer_changed:
            finding(
                "maintainer_change",
                "Maintainer set changed between adjacent published versions",
                "medium",
                registry_refs,
                previous_maintainers=meta.previous_maintainers,
            )
        if meta.version_jump:
            finding(
                "version_jump",
                meta.version_jump_note or "Unusual version jump between adjacent published versions",
                "medium",
                registry_refs,
            )
        if unmaintained:
            finding(
                "unmaintained",
                f"No release for {meta.days_since_latest_publish} days",
                "medium",
                registry_refs,
            )
        if (
            dimensions["concentration"] is not None
            and dimensions["concentration"] >= 50
            and len(graph.packages) >= 3
        ):
            finding(
                "maintainer_concentration",
                "Maintainer appears on at least half of installed instances",
                "medium",
                package.evidence_ids,
            )
    scores = [r["score"] for r in risks.values()]
    confidence = round(sum(r["confidence"] for r in risks.values()) / max(1, len(risks)))
    risk = max(scores, default=0)
    kinds = Counter(f["kind"] for f in findings)
    top = owners.most_common(1)
    goals = {
        "tree": {
            "direct": sum(p.direct for p in graph.packages),
            "transitive": sum(not p.direct for p in graph.packages),
            "max_depth": max((p.depth for p in graph.packages), default=0),
        },
        "vulnerabilities": {
            "total": kinds["vulnerability"],
            "reachable": sum(
                f["kind"] == "vulnerability" and f["reachability"]["level"] >= 1 for f in findings
            ),
            "unknown_reach": sum(
                f["kind"] == "vulnerability" and f["reachability"]["level"] == 0 for f in findings
            ),
        },
        "outdated": {
            "total": kinds["outdated"],
            **{
                e: sum(f["kind"] == "outdated" and f["upgrade_effort"] == e for f in findings)
                for e in ("major", "minor", "patch")
            },
        },
        "suspicious": {
            "maintainer_changes": kinds["maintainer_change"],
            "version_jumps": kinds["version_jump"],
            "install_scripts": kinds["lifecycle_capabilities"],
        },
        "license": {
            "conflicts": sum(f["kind"] == "license_conflict" and f["reason"] != "denied" for f in findings),
            "denied": sum(f["kind"] == "license_conflict" and f["reason"] == "denied" for f in findings),
            "unknown": sum(not p.license for p in graph.packages),
        },
        "concentration": {
            "top_maintainer": top[0][0] if top else "",
            "top_maintainer_share": round(top[0][1] / len(graph.packages), 3) if top else 0,
            "unmaintained": kinds["unmaintained"],
        },
    }
    return {
        "model_version": "risk-v2",
        "weights": WEIGHTS,
        "unknown_prior": 50,
        "risks": risks,
        "findings": findings,
        "summary": {
            "risk": risk,
            "trust": 100 - risk,
            "confidence": confidence,
            "aggregation": "maximum_package_risk",
            "packages": len(scores),
            "direct": sum(p.direct for p in graph.packages),
            "transitive": sum(not p.direct for p in graph.packages),
            "import_observed": sum(p.reachability.level >= 1 for p in graph.packages),
            "execution_proven": sum(p.reachability.level == 4 for p in graph.packages),
            "findings": len(findings),
            "goals": goals,
        },
        "limitations": [
            "Unknown dimensions use a 50/100 prior and widen the risk interval.",
            "AST module references do not prove exploitability, execution, or absence of runtime use.",
            "Maintainer change is observed between adjacent published versions only.",
            "Upgrade effort is a semver-distance estimate, not a build result.",
            "License compatibility is a small explicit SPDX table, not legal advice.",
        ],
    }

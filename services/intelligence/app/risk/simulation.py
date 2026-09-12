from collections import deque

from app.models import SimulationRequest
from app.risk.engine import topology, walk


def simulate(request: SimulationRequest) -> dict:
    graph = request.graph
    package = next((p for p in graph.packages if p.id == request.package_id), None)
    if package is None:
        raise KeyError(request.package_id)
    _, reverse = topology(graph)
    ancestors = walk(package.id, reverse)
    paths, queue = [], deque([(package.id, [package.id])])
    visited = {package.id}
    while queue:
        current, path = queue.popleft()
        for parent in sorted(reverse.get(current, ())):
            if parent not in visited:
                visited.add(parent)
                next_path = path + [parent]
                paths.append(next_path)
                queue.append((parent, next_path))
    script = bool(package.install_scripts or package.metadata.has_install_script)
    # A hypothetically compromised release can add a lifecycle script, so CI exposure does not
    # require one to exist today; an observed script only raises the weight.
    ci_exposure = request.ci_install and request.lifecycle_scripts_enabled
    capabilities = {c for s in package.install_scripts for c in s.capabilities}
    affected = ancestors - {graph.root_id}
    installed = max(1, sum(p.id != graph.root_id for p in graph.packages) - 1)
    # Coverage is the literal blast radius: the share of the install downstream of
    # this instance. Exposure only scales that share; it can never invent reach.
    factors = {
        "coverage": len(affected) / installed,
        "observed_import": 1.5 if package.reachability.level >= 1 else 1,
        "ci_exposure": (2 if script else 1.5) if ci_exposure else 1,
        "script_capabilities": 1 + len(capabilities) / 4 if script else 1,
    }
    exposure = factors["observed_import"] * factors["ci_exposure"] * factors["script_capabilities"]
    # ponytail: cube root is a ranking curve, not a calibrated probability. It keeps
    # small shares distinguishable; replace it once real incident data exists.
    radius = round(100 * factors["coverage"] ** (1 / 3) * (0.45 + 0.55 * (exposure - 1) / 5))
    propagation = []
    if ci_exposure:
        propagation = [
            {"source": package.id, "target": "asset:lifecycle-script"},
            {"source": "asset:lifecycle-script", "target": "asset:ci-runner"},
        ]
        propagation += [
            {"source": "asset:ci-runner", "target": f"category:{c}"}
            for c in sorted(set(request.credential_categories))
        ]
    return {
        "origin": package.id,
        "toxicity_radius": radius,
        "model_version": "atr-experimental-v1",
        "factors": factors,
        "affected_packages": sorted(affected),
        "installed_packages": installed,
        "dependency_paths": paths,
        "path_semantics": "one shortest reverse dependency path per ancestor",
        "propagation": propagation,
        "secret_exposure_potential": {
            c: ("high" if script else "possible") if ci_exposure else "unknown"
            for c in request.credential_categories
        },
        "assumptions": {
            "ci_install": request.ci_install,
            "lifecycle_scripts_enabled": request.lifecycle_scripts_enabled,
            "credential_categories": request.credential_categories,
            "observed_install_script": script,
        },
        "evidence_ids": package.evidence_ids + [s.evidence_id for s in package.install_scripts],
        "limitations": [
            "Hypothetical compromise model; no scripts are executed or secrets inspected.",
            "Dependency ancestry is not an execution path.",
            "ATR is an experimental ranking heuristic, not a calibrated probability.",
            "Runtime privilege is not modelled; no runtime instrumentation yet.",
        ],
    }

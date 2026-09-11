import pytest

from app.models import Evidence, Graph, Metadata, Package, Reachability


@pytest.fixture
def graph():
    packages = []
    evidence = []
    for name in ["client", "parser", "helper"]:
        eid = f"ev:{name}"
        evidence.append(Evidence(id=eid, kind="fixture", source="test", summary=name, confidence=1))
        packages.append(
            Package(
                id=name,
                purl=f"pkg:npm/{name}@1.0.0",
                ecosystem="npm",
                name=name,
                version="1.0.0",
                install_path=f"node_modules/{name}",
                direct=name == "client",
                depth=1 if name == "client" else 2,
                dev=False,
                license="MIT",
                metadata=Metadata(
                    registry_status="available",
                    osv_status="available",
                    maintainers=["owner"],
                    has_install_script=False,
                ),
                vulnerabilities=[],
                install_scripts=[],
                evidence_ids=[eid],
                reachability=Reachability(level=0, status="unknown", evidence_ids=[eid]),
            )
        )
    return Graph(
        schema_version="1.0",
        root_id="root",
        packages=packages,
        evidence=evidence,
        warnings=[],
        edges=[
            {"source": a, "target": b, "scope": "runtime", "requirement": "1", "reachable": False}
            for a, b in [("root", "client"), ("client", "parser"), ("parser", "helper")]
        ],
    )

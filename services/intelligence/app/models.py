from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Evidence(Model):
    id: str
    kind: str
    source: str
    location: str = ""
    sha256: str = ""
    summary: str
    confidence: float = Field(ge=0, le=1)


class Vulnerability(Model):
    id: str
    summary: str
    severity: Literal["critical", "high", "medium", "low", "unknown"]
    fixed_versions: list[str]
    evidence_id: str


class Script(Model):
    name: str
    capabilities: list[str]
    evidence_id: str


class Reachability(Model):
    level: int = Field(ge=0, le=4)
    status: Literal["unknown", "import_observed", "module_observed", "function_observed", "reachable"]
    evidence_ids: list[str]


class Metadata(Model):
    registry_status: Literal["unknown", "available", "unavailable", "fixture"]
    osv_status: Literal["unknown", "available", "unavailable", "fixture"]
    latest_version: str = ""
    maintainers: list[str]
    published_at: str = ""
    has_install_script: bool
    latest_published_at: str = ""
    major_gap: int = 0
    minor_gap: int = 0
    patch_gap: int = 0
    days_since_latest_publish: int = -1
    maintainer_changed: bool = False
    previous_maintainers: list[str] = Field(default_factory=list)
    version_jump: bool = False
    version_jump_note: str = ""


class Package(Model):
    id: str
    purl: str
    ecosystem: Literal["npm"]
    name: str
    version: str
    install_path: str
    direct: bool
    depth: int
    dev: bool
    license: str = ""
    metadata: Metadata
    vulnerabilities: list[Vulnerability]
    install_scripts: list[Script]
    reachability: Reachability
    evidence_ids: list[str]
    risk: dict | None = None


class Edge(Model):
    source: str
    target: str
    requirement: str
    scope: Literal["runtime", "dev", "optional", "peer"]
    reachable: bool


class Graph(Model):
    schema_version: Literal["1.0"]
    root_id: str
    project_license: str = ""
    packages: list[Package] = Field(max_length=5000)
    edges: list[Edge] = Field(max_length=50000)
    evidence: list[Evidence] = Field(max_length=100000)
    warnings: list[str]

    @model_validator(mode="after")
    def integrity(self):
        ids = {p.id for p in self.packages}
        if len(ids) != len(self.packages) or self.root_id in ids:
            raise ValueError("package instance IDs must be unique and separate from root")
        evidence = {e.id for e in self.evidence}
        if len(evidence) != len(self.evidence):
            raise ValueError("duplicate evidence IDs")
        valid_sources = ids | {self.root_id}
        for edge in self.edges:
            if edge.source not in valid_sources or edge.target not in ids:
                raise ValueError("dangling dependency edge")
        for package in self.packages:
            refs = (
                package.evidence_ids
                + package.reachability.evidence_ids
                + [v.evidence_id for v in package.vulnerabilities]
                + [s.evidence_id for s in package.install_scripts]
            )
            if not set(refs) <= evidence:
                raise ValueError("dangling evidence reference")
        return self


class AnalysisRequest(Model):
    graph: Graph
    denied_licenses: list[str] = Field(default_factory=list, max_length=100)


class SimulationRequest(AnalysisRequest):
    package_id: str
    ci_install: bool = False
    lifecycle_scripts_enabled: bool = False
    credential_categories: list[Literal["repository_token", "cloud_credentials", "database"]] = Field(
        default_factory=list, max_length=3
    )


class RemediationRequest(AnalysisRequest):
    max_changes: int = Field(default=10, ge=1, le=100)


class ExplainRequest(AnalysisRequest):
    package_id: str
    language: Literal["en", "hi", "bn", "ta", "te", "mr", "gu", "kn", "ml", "pa", "or"] = "en"
    use_ai: bool = False

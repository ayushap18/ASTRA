import httpx
from fastapi.testclient import TestClient

from app.main import app


def test_service_authentication(monkeypatch):
    monkeypatch.setenv("ASTRA_INTERNAL_TOKEN", "test-internal-key")
    client = TestClient(app)
    assert client.get("/ready").status_code == 401
    assert client.get("/ready", headers={"Authorization": "Bearer test-internal-key"}).status_code == 200


def test_api_analysis_validation_and_unknown_package(graph, monkeypatch):
    monkeypatch.delenv("ASTRA_INTERNAL_TOKEN", raising=False)
    client = TestClient(app)
    data = {"graph": graph.model_dump()}
    response = client.post("/v1/analyze", json=data)
    assert response.status_code == 200 and response.headers["X-Request-ID"]
    assert client.post("/v1/simulate", json={**data, "package_id": "absent"}).status_code == 404
    assert client.post("/v1/remediation", json={**data, "max_changes": 0}).status_code == 422
    assert client.post("/v1/analyze", json={**data, "llm_score": 99}).status_code == 422


def test_interpreter_falls_back_without_api_key(graph, monkeypatch):
    monkeypatch.delenv("ASTRA_INTERNAL_TOKEN", raising=False)
    monkeypatch.delenv("SARVAM_API_KEY", raising=False)
    response = TestClient(app).post(
        "/v1/explain",
        json={"graph": graph.model_dump(), "package_id": "client", "use_ai": True, "language": "hi"},
    )
    assert response.status_code == 200
    result = response.json()
    assert result["provider"] == "deterministic" and not result["ai_generated"]
    assert result["language"] == "en" and result["warnings"] and result["evidence_ids"]


def test_sarvam_payload_allowlist_excludes_source_and_prose(graph, monkeypatch):
    monkeypatch.delenv("ASTRA_INTERNAL_TOKEN", raising=False)
    monkeypatch.setenv("SARVAM_API_KEY", "test-provider-key")
    graph.evidence[0].summary = "PRIVATE_SOURCE_SENTINEL"
    captured = {}

    class Provider:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def post(self, url, **kwargs):
            captured.update(kwargs)
            assert url == "https://api.sarvam.ai/v1/chat/completions"
            return httpx.Response(
                200,
                request=httpx.Request("POST", url),
                json={"choices": [{"message": {"content": "Evidence commentary"}}]},
            )

    monkeypatch.setattr("app.ai.interpreter.httpx.AsyncClient", Provider)
    response = TestClient(app).post(
        "/v1/explain", json={"graph": graph.model_dump(), "package_id": "client", "use_ai": True}
    )
    assert response.status_code == 200 and response.json()["ai_generated"]
    import json

    payload = json.loads(captured["json"]["messages"][1]["content"])
    assert set(payload) == {
        "risk",
        "confidence",
        "dimensions",
        "finding_kinds",
        "vulnerability_count",
        "reachability_level",
    }
    assert "PRIVATE_SOURCE_SENTINEL" not in json.dumps(captured)


def test_sarvam_timeout_preserves_deterministic_answer(graph, monkeypatch):
    monkeypatch.delenv("ASTRA_INTERNAL_TOKEN", raising=False)
    monkeypatch.setenv("SARVAM_API_KEY", "test-provider-key")

    class Unavailable:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            raise httpx.ReadTimeout("provider timeout")

        async def __aexit__(self, *args):
            pass

    monkeypatch.setattr("app.ai.interpreter.httpx.AsyncClient", Unavailable)
    response = TestClient(app).post(
        "/v1/explain", json={"graph": graph.model_dump(), "package_id": "client", "use_ai": True}
    )
    assert response.status_code == 200
    assert response.json()["provider"] == "deterministic" and response.json()["warnings"]

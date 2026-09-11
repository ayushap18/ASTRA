import hmac
import json
import logging
import os
import time
import uuid

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import Field, model_validator

from app.ai.interpreter import explain
from app.models import AnalysisRequest, ExplainRequest, RemediationRequest, SimulationRequest
from app.optimizer.engine import plan
from app.reachability.engine import inspect_sources
from app.risk.engine import analyze
from app.risk.simulation import simulate

logger = logging.getLogger("astra.intelligence")
logger.setLevel(logging.INFO)
logger.propagate = False
if not logger.handlers:
    logger.addHandler(logging.StreamHandler())


def authenticate(authorization: str = Header(default="")):
    token = os.getenv("ASTRA_INTERNAL_TOKEN", "")
    if token and not hmac.compare_digest(authorization, "Bearer " + token):
        raise HTTPException(401, "Invalid service credential")


app = FastAPI(title="Astra Intelligence", version="0.1.0", dependencies=[Depends(authenticate)])


@app.middleware("http")
async def request_context(request: Request, call_next):
    request_id = str(uuid.uuid4())
    started = time.monotonic()
    # Bound actual bytes even when the caller omits Content-Length.
    if request.method == "POST":
        body = bytearray()
        async for chunk in request.stream():
            if len(body) + len(chunk) > 32 * 1024 * 1024:
                return JSONResponse(status_code=413, content={"detail": "Analysis input exceeds 32 MiB"})
            body.extend(chunk)
        request._body = bytes(body)
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    logger.info(
        json.dumps(
            {
                "event": "http_request",
                "service": "astra-intelligence",
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "duration_ms": round((time.monotonic() - started) * 1000),
            }
        )
    )
    return response


@app.get("/health")
@app.get("/ready")
def health():
    return {"status": "ok", "service": "astra-intelligence", "version": "0.1.0"}


class SourceRequest(AnalysisRequest):
    sources: dict[str, str] = Field(default_factory=dict, max_length=500)

    @model_validator(mode="after")
    def source_budget(self):
        if sum(len(v.encode()) for v in self.sources.values()) > 4 * 1024 * 1024:
            raise ValueError("source input exceeds 4 MiB")
        return self


@app.post("/v1/reachability")
def reachability(request: SourceRequest):
    return inspect_sources(request.graph, request.sources)


@app.post("/v1/analyze")
def analysis(request: AnalysisRequest):
    return analyze(request.graph, request.denied_licenses)


@app.post("/v1/simulate")
def simulation(request: SimulationRequest):
    try:
        return simulate(request)
    except KeyError:
        raise HTTPException(404, "Package instance not found") from None


@app.post("/v1/remediation")
def remediation(request: RemediationRequest):
    return plan(request)


@app.post("/v1/explain")
async def explanation(request: ExplainRequest):
    try:
        return await explain(request)
    except KeyError:
        raise HTTPException(404, "Package instance not found") from None

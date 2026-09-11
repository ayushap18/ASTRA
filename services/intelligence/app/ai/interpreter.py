import os

import httpx

from app.models import ExplainRequest
from app.risk.engine import analyze


async def explain(request: ExplainRequest) -> dict:
    package = next((p for p in request.graph.packages if p.id == request.package_id), None)
    if package is None:
        raise KeyError(request.package_id)
    analysis = analyze(request.graph, request.denied_licenses)
    risk = analysis["risks"][package.id]
    findings = [f for f in analysis["findings"] if f["package_id"] == package.id]
    # Allowlist numeric and enumerated evidence. No source, scripts, email, repository, or freeform question.
    payload = {
        "risk": risk["score"],
        "confidence": risk["confidence"],
        "dimensions": risk["dimensions"],
        "finding_kinds": sorted({f["kind"] for f in findings}),
        "vulnerability_count": len(package.vulnerabilities),
        "reachability_level": package.reachability.level,
    }
    text = (
        f"{package.name}@{package.version} has estimated risk {risk['score']}/100 "
        f"with evidence confidence {risk['confidence']}%. "
        f"{len(package.vulnerabilities)} known advisory matches were recorded. "
        f"Reachability level {package.reachability.level}/4; affected-function execution is unproven. "
        "Unknown dimensions are included using the documented prior. Review the linked evidence."
    )
    result = {
        "text": text,
        "provider": "deterministic",
        "language": "en",
        "requested_language": request.language,
        "evidence_ids": risk["evidence_ids"],
        "ai_generated": False,
        "warnings": [],
    }
    key = os.getenv("SARVAM_API_KEY")
    if not request.use_ai:
        if request.language != "en":
            result["warnings"].append("Translation requires the optional Sarvam interpreter.")
        return result
    if not key:
        result["warnings"].append("Sarvam is not configured; returning the evidence summary in English.")
        return result
    import json

    try:
        async with httpx.AsyncClient(timeout=45, follow_redirects=False) as client:
            response = await client.post(
                "https://api.sarvam.ai/v1/chat/completions",
                headers={"api-subscription-key": key},
                json={
                    "model": os.getenv("SARVAM_MODEL", "sarvam-105b"),
                    "temperature": 0,
                    "max_tokens": 4000,
                    # sarvam-105b reasons before answering; default effort exceeds the budget.
                    "reasoning_effort": "low",
                    "messages": [
                        {
                            "role": "system",
                            "content": "Explain only the supplied security evidence. "
                            "Never invent a vulnerability, execution path, patch, or score. Distinguish unknown "
                            "from safe. This is commentary on deterministic analysis. Reply in language "
                            + request.language,
                        },
                        {"role": "user", "content": json.dumps(payload, sort_keys=True)},
                    ],
                },
            )
            response.raise_for_status()
            answer = response.json()["choices"][0]["message"]["content"]
            if not isinstance(answer, str) or not answer.strip():
                raise ValueError("empty response")
            result.update(
                text=answer[:12000], provider="sarvam", ai_generated=True, language=request.language
            )
    except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError):
        result["warnings"].append("Sarvam unavailable; returning the deterministic evidence summary.")
    return result

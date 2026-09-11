#!/usr/bin/env python3
"""Export the Python-owned intelligence contract for clients and Go contract tests."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services/intelligence"))
from app.main import app  # noqa: E402
from app.models import Graph  # noqa: E402

(ROOT / "packages/schemas/graph.schema.json").write_text(
    json.dumps(Graph.model_json_schema(), indent=2) + "\n"
)
(ROOT / "packages/schemas/intelligence.openapi.json").write_text(json.dumps(app.openapi(), indent=2) + "\n")

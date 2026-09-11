#!/usr/bin/env python3
"""Exercise real Go + Python services, optionally with an ephemeral PostgreSQL instance."""

import argparse
import json
import os
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--postgres", action="store_true")
    parser.add_argument("--live", action="store_true", help="Also query the live npm registry and OSV")
    args = parser.parse_args()
    processes = []
    with tempfile.TemporaryDirectory(prefix="astra-smoke-") as temporary:
        temp = Path(temporary)
        log = (temp / "services.log").open("w+")
        core_port, python_port = port(), port()
        base = f"http://127.0.0.1:{core_port}"
        env = {
            **os.environ,
            "ASTRA_ADDR": f"127.0.0.1:{core_port}",
            "ASTRA_INTELLIGENCE_URL": f"http://127.0.0.1:{python_port}",
            "ASTRA_INTERNAL_TOKEN": "smoke-internal",
            "ASTRA_API_TOKEN": "smoke-api",
            "ASTRA_ENABLE_GITHUB": "false",
            "ASTRA_ENABLE_DEMO": "true",
            "DATABASE_URL": "",
        }
        env.pop("SARVAM_API_KEY", None)

        def start(command, cwd=ROOT):
            process = subprocess.Popen(command, cwd=cwd, env=env, stdout=log, stderr=log)
            processes.append(process)
            return process

        def request(route, body=None, method=None, headers=None):
            req = urllib.request.Request(
                base + route,
                data=None if body is None else json.dumps(body).encode(),
                method=method,
                headers={
                    "Authorization": "Bearer smoke-api",
                    "Content-Type": "application/json",
                    **(headers or {}),
                },
            )
            with urllib.request.urlopen(req, timeout=30) as response:
                content = response.read().decode()
                return response.status, content if route.endswith("/events") else json.loads(content)

        def ready():
            for _ in range(100):
                try:
                    if request("/ready")[0] == 200:
                        return
                except (OSError, urllib.error.HTTPError):
                    pass
                time.sleep(0.1)
            raise AssertionError("services did not become ready")

        try:
            if args.postgres:
                assert shutil.which("initdb") and shutil.which("postgres"), "PostgreSQL binaries required"
                database_port = port()
                subprocess.run(
                    [
                        "initdb",
                        "-D",
                        str(temp / "pg"),
                        "--auth-local=trust",
                        "--auth-host=trust",
                        "--username=astra",
                        "--no-locale",
                        "-E",
                        "UTF8",
                    ],
                    check=True,
                    stdout=log,
                    stderr=log,
                )
                start(
                    [
                        "postgres",
                        "-D",
                        str(temp / "pg"),
                        "-h",
                        "127.0.0.1",
                        "-p",
                        str(database_port),
                        "-k",
                        str(temp),
                    ]
                )
                for _ in range(100):
                    probe = subprocess.run(
                        ["pg_isready", "-h", "127.0.0.1", "-p", str(database_port)],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                        check=False,
                    )
                    if probe.returncode == 0:
                        break
                    time.sleep(0.1)
                env["DATABASE_URL"] = f"postgres://astra@127.0.0.1:{database_port}/postgres?sslmode=disable"
                test_env = {**env, "ASTRA_TEST_DATABASE_URL": env["DATABASE_URL"]}
                subprocess.run(
                    ["go", "test", "./internal/store", "-count=1"],
                    cwd=ROOT / "services/core",
                    env=test_env,
                    check=True,
                )
            python = ROOT / "services/intelligence/.venv/bin/python"
            assert python.exists(), "Run make setup first"
            start(
                [
                    str(python),
                    "-m",
                    "uvicorn",
                    "app.main:app",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    str(python_port),
                ],
                ROOT / "services/intelligence",
            )
            core = start([str(ROOT / "bin/astra")])
            ready()
            status, accepted = request(
                "/api/v1/scans", {"source": "demo", "denied_licenses": ["GPL-3.0-only"]}
            )
            assert status == 202
            scan_path = "/api/v1/scans/" + accepted["scan_id"]
            for _ in range(100):
                _, scan = request(scan_path)
                if scan["status"] in {"completed", "partial", "failed"}:
                    break
                time.sleep(0.1)
            assert scan["status"] == "completed", scan
            _, listed = request("/api/v1/scans")
            assert any(item["id"] == accepted["scan_id"] for item in listed["scans"])
            assert "lockfileVersion" not in json.dumps(listed)
            _, graph = request(scan_path + "/graph")
            assert len(graph["packages"]) == 6
            parsers = [p for p in graph["packages"] if p["name"] == "astra-demo-parser"]
            assert len(parsers) == 2 and parsers[0]["id"] != parsers[1]["id"]
            evidence_ids = {e["id"] for e in graph["evidence"]}
            client = next(p for p in graph["packages"] if p["name"] == "astra-demo-client")
            assert client["reachability"]["level"] == 2
            assert client["reachability"]["status"] == "module_observed"
            assert any(e["source"] == "static-ast-v2" for e in graph["evidence"])
            _, findings = request(scan_path + "/findings")
            assert findings["findings"] and findings["summary"]["execution_proven"] == 0
            for finding in findings["findings"]:
                assert set(finding["evidence_ids"]) <= evidence_ids
            helper = next(p for p in graph["packages"] if p["name"] == "astra-demo-build-helper")
            _, simulation = request(
                scan_path + "/simulate",
                {
                    "package_id": helper["id"],
                    "ci_install": True,
                    "lifecycle_scripts_enabled": True,
                    "credential_categories": ["repository_token"],
                },
            )
            assert (
                simulation["propagation"]
                and simulation["secret_exposure_potential"]["repository_token"] == "high"
            )
            _, remediation = request(scan_path + "/remediation", {"max_changes": 3})
            assert remediation["changes"] and len(remediation["changes"]) <= 3 and not remediation["verified"]
            assert isinstance(remediation["predicted_risk"], (int, float))
            _, explanation = request(scan_path + "/explain", {"package_id": helper["id"], "use_ai": True})
            assert explanation["provider"] == "deterministic" and explanation["evidence_ids"]
            _, stream = request(scan_path + "/events", headers={"Last-Event-ID": "1"})
            assert "SCAN_CREATED" not in stream and "SCAN_COMPLETED" in stream
            try:
                request(scan_path + "/remediation", {"max_changes": 0})
                raise AssertionError("invalid action accepted")
            except urllib.error.HTTPError as error:
                assert error.code == 422
            if args.postgres:
                core.terminate()
                core.wait(timeout=15)
                start([str(ROOT / "bin/astra")])
                ready()
                assert request(scan_path + "/graph")[1] == graph, "graph did not survive restart"
                with urllib.request.urlopen(
                    urllib.request.Request(base + "/metrics", headers={"Authorization": "Bearer smoke-api"})
                ) as response:
                    assert b"astra_http_requests_total" in response.read()
            if args.live:
                manifest = {"name": "live-test", "dependencies": {"lodash": "4.17.19"}}
                _, live = request(
                    "/api/v1/scans",
                    {
                        "source": "lockfile",
                        "manifest": manifest,
                        "lockfile": {
                            "lockfileVersion": 3,
                            "packages": {
                                "": manifest,
                                "node_modules/lodash": {"version": "4.17.19", "license": "MIT"},
                            },
                        },
                        "sources": {"src/index.js": "const lodash = require('lodash');\n"},
                    },
                )
                live_path = "/api/v1/scans/" + live["scan_id"]
                for _ in range(300):
                    _, live_scan = request(live_path)
                    if live_scan["status"] in {"completed", "partial", "failed"}:
                        break
                    time.sleep(0.1)
                assert live_scan["status"] == "completed", live_scan
                _, live_graph = request(live_path + "/graph")
                live_package = live_graph["packages"][0]
                assert live_package["metadata"]["osv_status"] == "available"
                assert live_package["metadata"]["registry_status"] == "available"
                assert live_package["vulnerabilities"] and live_package["reachability"]["level"] == 2
            print(
                json.dumps(
                    {
                        "status": "passed",
                        "storage": "postgres" if args.postgres else "memory",
                        "packages": len(graph["packages"]),
                        "findings": len(findings["findings"]),
                        "proposed_changes": len(remediation["changes"]),
                        "sse_replay": True,
                        "persistence_restart": args.postgres,
                        "live_npm_osv": args.live,
                    },
                    indent=2,
                )
            )
        except BaseException:
            log.flush()
            print((temp / "services.log").read_text()[-16000:])
            raise
        finally:
            for process in reversed(processes):
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=15)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
            log.close()


if __name__ == "__main__":
    main()

import assert from "node:assert/strict";
import test from "node:test";
import {
  installAncestors,
  investigationHref,
  parseInvestigationSearch,
  workbenchExport,
} from "./investigation.ts";
import type { Scan } from "./types.ts";

test("investigation href keeps instance id and finding in the query", () => {
  const href = investigationHref("/scans/as_1/graph", {
    package: "pkg:npm/a@1#node_modules/a",
    finding: "fnd_1",
  });
  assert.equal(
    href,
    "/scans/as_1/graph?package=pkg%3Anpm%2Fa%401%23node_modules%2Fa&finding=fnd_1",
  );
  const parsed = parseInvestigationSearch(new URLSearchParams(href.split("?")[1]));
  assert.equal(parsed.package, "pkg:npm/a@1#node_modules/a");
  assert.equal(parsed.finding, "fnd_1");
});

test("install ancestors walk dependants toward the root and skip cycles", () => {
  const ancestors = installAncestors(
    [
      { source: "root", target: "mid", scope: "runtime" },
      { source: "mid", target: "leaf", scope: "runtime" },
      { source: "leaf", target: "mid", scope: "runtime" },
    ],
    "leaf",
  );
  assert.deepEqual([...ancestors].sort(), ["mid", "root"]);
});

test("workbench export omits source bodies and labels limitations", () => {
  const scan: Scan = {
    id: "as_1",
    source: "demo",
    status: "completed",
    created_at: "t",
    updated_at: "t",
    events: [],
  };
  const report = workbenchExport({
    scan,
    findings: [],
    graph: {
      root_id: "root",
      packages: [],
      edges: [],
      evidence: [],
      warnings: ["provider timeout"],
    },
    exportedAt: "2026-09-11T00:00:00.000Z",
  });
  assert.equal(report.kind, "workbench-export");
  assert.ok(!("sources" in report));
  assert.match(report.limitations[0] ?? "", /not a verified patch/);
});

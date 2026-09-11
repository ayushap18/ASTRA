import assert from "node:assert/strict";
import test from "node:test";
import { graphElements } from "./graph-layout.ts";

test("graph elements keep instance ids and skip missing endpoints", () => {
  const { nodes, edges } = graphElements({
    root_id: "root",
    packages: [
      { id: "a", name: "a", version: "1.0.0", purl: "pkg:npm/a@1.0.0", depth: 1, direct: true },
      { id: "b", name: "b", version: "1.0.0", purl: "pkg:npm/b@1.0.0", depth: 2, direct: false },
    ],
    edges: [
      { source: "root", target: "a", scope: "runtime" },
      { source: "a", target: "b", scope: "runtime" },
      { source: "a", target: "missing", scope: "optional" },
    ],
    warnings: [],
    evidence: [],
  });
  assert.deepEqual(
    nodes.map((node) => node.id),
    ["a", "b"],
  );
  assert.equal(nodes[0]?.data.label, "a@1.0.0");
  assert.deepEqual(
    edges.map((edge) => `${edge.source}->${edge.target}`),
    ["a->b"],
  );
  assert.notEqual(nodes[0]?.position.y, nodes[1]?.position.y);
});

import assert from "node:assert/strict";
import test from "node:test";
import { filesFromZip } from "./zip-ingest.ts";

test("zip ingest keeps project files and drops traversal", () => {
  const scan = filesFromZip({
    "repo/package.json": new TextEncoder().encode(`{"name":"demo"}`),
    "repo/package-lock.json": new TextEncoder().encode(`{"lockfileVersion":3,"packages":{}}`),
    "repo/src/index.ts": new TextEncoder().encode("import './x'"),
    "repo/../secret": new TextEncoder().encode("no"),
  });
  assert.equal(scan.source, "lockfile");
  assert.deepEqual(scan.manifest, { name: "demo" });
  assert.equal(scan.sources["src/index.ts"], "import './x'");
  assert.equal(scan.sources["../secret"], undefined);
});

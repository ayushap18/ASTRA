import assert from "node:assert/strict";
import test from "node:test";
import { remediationPayload, simulatePayload } from "./payloads.ts";

test("simulate payload uses instance id and category names only", () => {
  assert.deepEqual(
    simulatePayload({
      packageId: "pkg:npm/foo@1.0.0#node_modules/foo",
      ciInstall: true,
      lifecycleScripts: false,
      categories: ["repository_token", "database"],
    }),
    {
      package_id: "pkg:npm/foo@1.0.0#node_modules/foo",
      ci_install: true,
      lifecycle_scripts_enabled: false,
      credential_categories: ["repository_token", "database"],
    },
  );
});

test("remediation payload is a bounded change count", () => {
  assert.deepEqual(remediationPayload(3), { max_changes: 3 });
  assert.throws(() => remediationPayload(0));
  assert.throws(() => remediationPayload(101));
});

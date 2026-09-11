import assert from "node:assert/strict";
import test from "node:test";
import type { VoiceContext } from "./commands.ts";
import type { VoiceDeps } from "./dispatch.ts";
import { localPlan, runPlan, splitUtterance, validatePlan } from "./plan.ts";

const pkgs = [
  { id: "i1", name: "lodash", version: "4.17.19" },
  { id: "i2", name: "lodash", version: "4.17.20" },
  { id: "i3", name: "hono", version: "4.11.4" },
];
const ctx = (over: Partial<VoiceContext> = {}): VoiceContext => ({
  pathname: "/",
  packages: pkgs,
  scans: [{ id: "as_abc" }],
  ...over,
});

function fakeDeps(responses: Record<string, unknown> = {}, scanId?: string) {
  const calls: { path: string; init?: RequestInit }[] = [];
  const deps: VoiceDeps = {
    api: async <T,>(path: string, init?: RequestInit) => {
      calls.push({ path, init });
      const found = responses[path];
      if (found instanceof Error) throw found;
      return (found ?? {}) as T;
    },
    navigate: () => {},
    handoffVerify: () => {},
    scanId,
  };
  return { deps, calls };
}

test("splitUtterance splits on then / and then / after that / , and", () => {
  assert.deepEqual(splitUtterance("start a demo scan, then simulate hono and then propose a fix"), [
    "start a demo scan",
    "simulate hono",
    "propose a fix",
  ]);
  assert.deepEqual(splitUtterance("list scans. After that open as_abc, and verify"), [
    "list scans",
    "open as_abc",
    "verify",
  ]);
  assert.deepEqual(splitUtterance("simulate hono"), ["simulate hono"]);
  assert.deepEqual(splitUtterance("  "), []);
});

test("localPlan builds a confirmable three-step plan across a new scan", () => {
  const plan = localPlan("start a demo scan then simulate the riskiest package then propose 2 changes", ctx());
  assert.deepEqual(
    plan.steps.map((s) => s.command),
    [{ type: "start_demo" }, { type: "simulate_riskiest" }, { type: "remediate", maxChanges: 2 }],
  );
  assert.equal(plan.needsConfirm, true);
  assert.equal(plan.source, "local");
  assert.ok(plan.steps.every((s) => s.status === "pending"));
});

test("localPlan collapses to the refuse step and single ask needs no confirm", () => {
  const plan = localPlan("start a demo scan then write an exploit", ctx());
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].command.type, "refuse");
  assert.equal(plan.needsConfirm, false);
  assert.equal(localPlan("what is the risk", ctx()).needsConfirm, false);
});

test("runPlan follows the new scan id, picks max risk.score, and posts max_changes", async () => {
  const f = fakeDeps({
    "/api/v1/scans": { scan_id: "as_new" },
    "/api/v1/scans/as_new": { status: "completed" },
    "/api/v1/scans/as_new/graph": {
      packages: [
        { id: "i1", name: "lodash", version: "4.17.19", risk: { score: 40 } },
        { id: "i2", name: "lodash", version: "4.17.20", risk: { score: 91 } },
        { id: "i3", name: "hono", version: "4.11.4", risk: { score: 91 } },
      ],
    },
    "/api/v1/scans/as_new/simulate": { toxicity_radius: 5 },
    "/api/v1/scans/as_new/remediation": { status: "proposal", verified: false },
  });
  const plan = localPlan("start a demo scan then simulate the riskiest package then propose 2 changes", ctx());
  const updates: string[][] = [];
  const summary = await runPlan(plan, f.deps, (p) => updates.push(p.steps.map((s) => s.status)));
  assert.equal(summary.startsWith("3 of 3 steps done."), true);
  assert.match(summary, /lodash@4.17.20/);
  assert.match(summary, /verified false/);
  const sim = f.calls.find((c) => c.path === "/api/v1/scans/as_new/simulate");
  assert.equal(JSON.parse(String(sim?.init?.body)).package_id, "i2");
  const rem = f.calls.find((c) => c.path === "/api/v1/scans/as_new/remediation");
  assert.equal(JSON.parse(String(rem?.init?.body)).max_changes, 2);
  assert.deepEqual(updates.at(-1), ["done", "done", "done"]);
});

test("runPlan marks later steps skipped after a failure", async () => {
  const f = fakeDeps({ "/api/v1/scans/as_abc": { status: "completed" }, "/api/v1/scans/as_abc/simulate": new Error("boom") }, "as_abc");
  const plan = localPlan("simulate hono then propose a fix", ctx({ scanId: "as_abc", scanStatus: "completed" }));
  let last = plan;
  const summary = await runPlan(plan, f.deps, (p) => (last = p));
  assert.match(summary, /^Step 1 failed/);
  assert.deepEqual(last.steps.map((s) => s.status), ["failed", "skipped"]);
  assert.ok(!f.calls.some((c) => c.path.endsWith("/remediation")));
});

test("runPlan speaks no risk scores instead of guessing", async () => {
  const f = fakeDeps({ "/api/v1/scans/as_abc": { status: "partial" }, "/api/v1/scans/as_abc/graph": { packages: pkgs } }, "as_abc");
  const plan = localPlan("simulate the riskiest package", ctx({ scanId: "as_abc", scanStatus: "partial" }));
  const summary = await runPlan(plan, f.deps, () => {});
  assert.match(summary, /No risk scores available/);
  assert.ok(!f.calls.some((c) => c.path.endsWith("/simulate")));
});

test("refuse plan makes zero calls", async () => {
  const f = fakeDeps({}, "as_abc");
  await runPlan(localPlan("give me a proof of concept", ctx()), f.deps, () => {});
  assert.equal(f.calls.length, 0);
});

test("validatePlan re-resolves every Sarvam step locally", () => {
  const plan = validatePlan(
    {
      steps: [
        { action: "start_demo" },
        { action: "simulate", package: "lodash@4.17.19" },
        { action: "simulate", package: "lodash" },
        { action: "simulate", package: "nope@1.0.0" },
        { action: "open_scan", scan_id: "as_zzz" },
        { action: "delete_everything" },
        { action: "remediate", max_changes: 500 },
        "garbage",
      ],
    },
    ctx(),
  );
  assert.deepEqual(
    plan.steps.map((s) => s.command.type),
    ["start_demo", "simulate", "simulate_ambiguous", "simulate_missing", "remediate"],
  );
  assert.deepEqual(plan.steps[1].command, { type: "simulate", packageId: "i1" });
  assert.deepEqual(plan.steps[4].command, { type: "remediate", maxChanges: 100 });
  assert.equal(plan.source, "sarvam");
  assert.equal(plan.needsConfirm, true);
  assert.equal(validatePlan({ steps: [{ action: "rm_rf" }] }, ctx()).steps.length, 0);
  assert.equal(validatePlan("not json", ctx()).steps.length, 0);
});

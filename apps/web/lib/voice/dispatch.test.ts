import assert from "node:assert/strict";
import test from "node:test";
import { confirmRemediation, dispatchVoiceCommand, type VoiceDeps } from "./dispatch.ts";

type Call = { path: string; init?: RequestInit };

function fakeDeps(responses: Record<string, unknown> = {}, scanId = "as_abc") {
  const calls: Call[] = [];
  const nav: string[] = [];
  let verify = 0;
  const deps: VoiceDeps = {
    api: async <T,>(path: string, init?: RequestInit) => {
      calls.push({ path, init });
      const found = responses[path];
      if (found instanceof Error) throw found;
      return (found ?? {}) as T;
    },
    navigate: (href) => nav.push(href),
    handoffVerify: () => {
      verify += 1;
    },
    scanId,
  };
  return { deps, calls, nav, verifyCount: () => verify };
}

test("start_demo POSTs exactly {source:demo} then navigates", async () => {
  const f = fakeDeps({ "/api/v1/scans": { scan_id: "as_new" } });
  const r = await dispatchVoiceCommand({ type: "start_demo" }, f.deps);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(f.calls[0].init?.body)), { source: "demo" });
  assert.deepEqual(f.nav, ["/scans/as_new"]);
  assert.equal(r.navigateTo, "/scans/as_new");
});

test("simulate uses instance id and safe defaults", async () => {
  const f = fakeDeps({ "/api/v1/scans/as_abc/simulate": { toxicity_radius: 2 } });
  const r = await dispatchVoiceCommand({ type: "simulate", packageId: "i2" }, f.deps);
  assert.equal(f.calls[0].path, "/api/v1/scans/as_abc/simulate");
  assert.deepEqual(JSON.parse(String(f.calls[0].init?.body)), {
    package_id: "i2",
    ci_install: false,
    lifecycle_scripts_enabled: false,
    credential_categories: [],
  });
  assert.match(r.speak, /hypothetical/);
  assert.match(r.speak, /Ancestry is not an execution path/);
  assert.match(r.speak, /2/);
});

test("remediate returns pendingRemediation without POST", async () => {
  const f = fakeDeps();
  const r = await dispatchVoiceCommand({ type: "remediate", maxChanges: 5 }, f.deps);
  assert.equal(f.calls.length, 0);
  assert.equal(r.pendingRemediation, 5);
  assert.match(r.speak, /up to 5 changes/);
});

test("confirmRemediation POSTs bounded max_changes and never says safe", async () => {
  const f = fakeDeps({
    "/api/v1/scans/as_abc/remediation": { status: "proposal", verified: false },
  });
  const r = await confirmRemediation(3, f.deps);
  assert.equal(f.calls[0].path, "/api/v1/scans/as_abc/remediation");
  assert.deepEqual(JSON.parse(String(f.calls[0].init?.body)), { max_changes: 3 });
  assert.equal(r.speak, "Proposal returned. Status proposal, verified false.");
  assert.doesNotMatch(r.speak, /safe|fixed/i);
  const bad = await confirmRemediation(101, f.deps);
  assert.equal(f.calls.length, 1);
  assert.match(bad.speak, /1 to 100/);
});

test("refuse makes zero API calls", async () => {
  const f = fakeDeps();
  const r = await dispatchVoiceCommand({ type: "refuse", reason: "exploit" }, f.deps);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.nav, []);
  assert.match(r.speak, /^I will not do that\./);
});

test("verify_handoff navigates then calls handoffVerify", async () => {
  const f = fakeDeps();
  await dispatchVoiceCommand({ type: "verify_handoff" }, f.deps);
  assert.deepEqual(f.nav, ["/scans/as_abc/remediate"]);
  assert.equal(f.verifyCount(), 1);
  assert.equal(f.calls.length, 0);
});

test("simulate_ambiguous returns candidates with no API call", async () => {
  const f = fakeDeps();
  const candidates = [
    { id: "i1", name: "lodash", version: "4.17.19" },
    { id: "i2", name: "lodash", version: "4.17.20" },
  ];
  const r = await dispatchVoiceCommand({ type: "simulate_ambiguous", candidates }, f.deps);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(r.candidates, candidates);
});

test("list speaks counts and queue limits; queue_full is honest", async () => {
  const f = fakeDeps({
    "/api/v1/scans": { scans: [{ status: "running" }, { status: "queued" }, { status: "completed" }] },
  });
  const r = await dispatchVoiceCommand({ type: "list" }, f.deps);
  assert.equal(r.speak, "1 running, 1 queued, 3 total. Two workers, eighteen admitted.");
  const full = fakeDeps({ "/api/v1/scans": new Error("queue_full") });
  const e = await dispatchVoiceCommand({ type: "start_demo" }, full.deps);
  assert.match(e.speak, /queue is full, 18 admitted/);
});

test("start_github hands off to the form when github is disabled", async () => {
  const f = fakeDeps({ "/api/v1/scans": new Error("github_disabled (403)") });
  const r = await dispatchVoiceCommand(
    { type: "start_github", repository: "https://github.com/acme/app" },
    f.deps,
  );
  assert.deepEqual(JSON.parse(String(f.calls[0].init?.body)), {
    source: "github",
    repository: "https://github.com/acme/app",
  });
  assert.deepEqual(f.nav, ["/#scan"]);
  assert.equal(r.navigateTo, "/#scan");
});

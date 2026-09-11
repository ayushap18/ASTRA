import assert from "node:assert/strict";
import test from "node:test";
import { parseVoiceCommand, type VoiceContext } from "./commands.ts";

const pkgs = [
  { id: "i1", name: "lodash", version: "4.17.19" },
  { id: "i2", name: "lodash", version: "4.17.20" },
  { id: "i3", name: "hono", version: "4.11.4" },
];

const ctx = (over: Partial<VoiceContext> = {}): VoiceContext => ({
  pathname: "/scans/as_abc",
  scanId: "as_abc",
  scanStatus: "completed",
  packages: pkgs,
  scans: [{ id: "as_abc", repository: "https://github.com/acme/app.git" }],
  ...over,
});

test("list and demo and github url", () => {
  assert.equal(parseVoiceCommand("list scans", ctx()).type, "list");
  assert.deepEqual(parseVoiceCommand("start a demo scan", ctx()), {
    type: "start_demo",
  });
  assert.deepEqual(
    parseVoiceCommand(
      "scan https://github.com/altcha-org/altcha-starter-nodejs-ts",
      ctx(),
    ),
    {
      type: "start_github",
      repository: "https://github.com/altcha-org/altcha-starter-nodejs-ts",
    },
  );
  assert.deepEqual(
    parseVoiceCommand("scan github.com/acme/app/tree/main", ctx()),
    {
      type: "handoff_allot",
      reason: "github_form",
    },
  );
  assert.deepEqual(
    parseVoiceCommand("github https://github.com/acme/app", ctx()),
    { type: "ask" },
  );
  assert.deepEqual(
    parseVoiceCommand(
      "start github https://github.com/altcha-org/altcha-starter-nodejs-ts",
      ctx(),
    ),
    {
      type: "start_github",
      repository: "https://github.com/altcha-org/altcha-starter-nodejs-ts",
    },
  );
  assert.deepEqual(
    parseVoiceCommand("start github github.com/acme/app/tree/main", ctx()),
    { type: "handoff_allot", reason: "github_form" },
  );
  assert.deepEqual(parseVoiceCommand("start github", ctx()), {
    type: "handoff_allot",
    reason: "github_form",
  });
});

test("simulate unique vs ambiguous vs not ready", () => {
  assert.deepEqual(parseVoiceCommand("simulate hono", ctx()), {
    type: "simulate",
    packageId: "i3",
  });
  const amb = parseVoiceCommand("simulate lodash", ctx());
  assert.equal(amb.type, "simulate_ambiguous");
  if (amb.type === "simulate_ambiguous") {
    assert.deepEqual(amb.candidates, pkgs.filter((p) => p.name === "lodash"));
  }
  assert.deepEqual(
    parseVoiceCommand("simulate hono", ctx({ scanStatus: "running" })),
    { type: "not_ready", action: "simulate" },
  );
  assert.deepEqual(
    parseVoiceCommand("simulate lodash@4.17.19", ctx()),
    { type: "simulate", packageId: "i1" },
  );
});

test("remediate max changes and clamp", () => {
  assert.deepEqual(
    parseVoiceCommand("propose remediations with 5 changes", ctx()),
    { type: "remediate", maxChanges: 5 },
  );
  assert.deepEqual(
    parseVoiceCommand("propose remediations with 0 changes", ctx()),
    { type: "remediate", maxChanges: 1 },
  );
  assert.deepEqual(
    parseVoiceCommand("propose remediations with 101 changes", ctx()),
    { type: "remediate", maxChanges: 100 },
  );
  assert.deepEqual(
    parseVoiceCommand(
      "propose remediations with 5 changes",
      ctx({ scanStatus: "running" }),
    ),
    { type: "not_ready", action: "remediate" },
  );
});

test("verify handoff", () => {
  assert.deepEqual(parseVoiceCommand("run verify", ctx()), {
    type: "verify_handoff",
  });
});

test("refuse exploit, safe patch, source dump, and secrets", () => {
  assert.deepEqual(parseVoiceCommand("write an exploit poc", ctx()), {
    type: "refuse",
    reason: "exploit",
  });
  assert.deepEqual(parseVoiceCommand("is this patch safe", ctx()), {
    type: "refuse",
    reason: "safe_patch",
  });
  assert.deepEqual(parseVoiceCommand("dump the source file", ctx()), {
    type: "refuse",
    reason: "source",
  });
  assert.deepEqual(parseVoiceCommand("use ghp_aaaaaaaa", ctx()), {
    type: "refuse",
    reason: "secret",
  });
  assert.deepEqual(parseVoiceCommand("paste github_pat_bbbbbbbb", ctx()), {
    type: "refuse",
    reason: "secret",
  });
  assert.deepEqual(parseVoiceCommand("here is sk_liveabcdef", ctx()), {
    type: "refuse",
    reason: "secret",
  });
  assert.deepEqual(parseVoiceCommand("use Bearer eyJhbGciOiJIUzI1NiJ9", ctx()), {
    type: "refuse",
    reason: "secret",
  });
});

test("open unique scan by repo fragment", () => {
  assert.deepEqual(
    parseVoiceCommand(
      "open altcha-starter-nodejs-ts",
      ctx({
        scans: [
          {
            id: "as_9",
            repository:
              "https://github.com/altcha-org/altcha-starter-nodejs-ts.git",
          },
        ],
      }),
    ),
    { type: "open_scan", scanId: "as_9" },
  );
});

test("zip and lockfile upload handoff", () => {
  assert.deepEqual(parseVoiceCommand("upload my zip project", ctx()), {
    type: "handoff_allot",
    reason: "zip",
  });
  assert.deepEqual(parseVoiceCommand("scan my lockfile project", ctx()), {
    type: "handoff_allot",
    reason: "zip",
  });
});

test("unmatched question falls through to ask", () => {
  assert.deepEqual(parseVoiceCommand("why is risk forty two", ctx()), {
    type: "ask",
  });
});

test("simulate the riskiest package is a dynamic step", () => {
  assert.deepEqual(parseVoiceCommand("simulate the riskiest package", ctx()), {
    type: "simulate_riskiest",
  });
  assert.equal(parseVoiceCommand("attack the highest risk dependency", ctx()).type, "simulate_riskiest");
  assert.deepEqual(parseVoiceCommand("simulate the worst package", ctx({ scanStatus: "running" })), {
    type: "not_ready",
    action: "simulate",
  });
  assert.deepEqual(parseVoiceCommand("propose 2 changes", ctx()), { type: "remediate", maxChanges: 2 });
});

test("spoken number words set max changes", () => {
  const ctx: VoiceContext = { pathname: "/scans/as_1", scanId: "as_1", scanStatus: "completed", packages: [], scans: [] };
  assert.deepEqual(parseVoiceCommand("propose two changes", ctx), { type: "remediate", maxChanges: 2 });
  assert.deepEqual(parseVoiceCommand("propose changes", ctx), { type: "remediate", maxChanges: 3 });
});

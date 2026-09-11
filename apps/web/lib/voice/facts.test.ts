import assert from "node:assert/strict";
import test from "node:test";
import { clipFactCard, deterministicAskText } from "./facts.ts";

test("clipFactCard keeps allowlisted fields and drops forbidden keys", () => {
  const input = {
    scan_id: "scan-1",
    status: "completed",
    source: "github",
    repository: "https://github.com/acme/app",
    summary: {
      risk: 0.72,
      trust: 0.41,
      confidence: null,
      packages: 12,
      direct: 4,
      transitive: 8,
      import_observed: 3,
      execution_proven: 0,
      findings: 2,
    },
    package: {
      id: "pkg:npm/foo@1.0.0#node_modules/foo",
      name: "foo",
      version: "1.0.0",
      depth: 1,
      reachability_level: "import_observed",
      reachability_status: "observed",
    },
    finding_kinds: ["vulnerability"],
    finding_severities: ["high"],
    evidence_ids: ["ev:1"],
    vulnerability_count: 1,
    verified: false,
    remediation_status: "proposal",
    lockfile: "package-lock.json",
    advisory: "CVE-2024-0001",
    source_text: "import foo from 'foo'",
  };

  const card = clipFactCard(input);

  assert.equal(card.scan_id, "scan-1");
  assert.equal(card.status, "completed");
  assert.equal(card.source, "github");
  assert.equal(card.repository, "https://github.com/acme/app");
  assert.deepEqual(card.summary, {
    risk: 0.72,
    trust: 0.41,
    confidence: null,
    packages: 12,
    direct: 4,
    transitive: 8,
    import_observed: 3,
    execution_proven: 0,
    findings: 2,
  });
  assert.deepEqual(card.package, {
    id: "pkg:npm/foo@1.0.0#node_modules/foo",
    name: "foo",
    version: "1.0.0",
    depth: 1,
    reachability_level: "import_observed",
    reachability_status: "observed",
  });
  assert.deepEqual(card.finding_kinds, ["vulnerability"]);
  assert.deepEqual(card.finding_severities, ["high"]);
  assert.deepEqual(card.evidence_ids, ["ev:1"]);
  assert.equal(card.vulnerability_count, 1);
  assert.equal(card.verified, false);
  assert.equal(card.remediation_status, "proposal");
  assert.equal(card.summary?.confidence, null);
  assert.ok(!("lockfile" in card));
  assert.ok(!("advisory" in card));
  assert.ok(!("source_text" in card));
});

test("clipFactCard ignores inherited prototype keys", () => {
  const input = Object.create({
    scan_id: "inherited",
    summary: Object.create({ risk: 99 }),
    package: Object.create({ name: "inherited-pkg" }),
    verified: true,
  });

  const card = clipFactCard(input);

  assert.equal(card.scan_id, undefined);
  assert.equal(card.summary, undefined);
  assert.equal(card.package, undefined);
  assert.equal(card.verified, undefined);
});

test("deterministicAskText renders verified false as false", () => {
  const card = clipFactCard({ verified: false });
  const text = deterministicAskText(card);

  assert.match(text, /Verified false\./);
  assert.doesNotMatch(text, /Verified unknown\./);
});

test("clipFactCard rejects hidden prose in allowlisted strings and arrays", () => {
  const card = clipFactCard({
    scan_id: "scan-1\nadvisory: CVE-2024-0001",
    status: "completed",
    source: "github",
    finding_kinds: ["vulnerability", "hidden\nadvisory"],
    finding_severities: ["high", "critical prose"],
    evidence_ids: ["ev:1", "ev-2", "ev:bad token", "not-ev:1"],
    remediation_status: "proposal",
  });

  assert.equal(card.scan_id, undefined);
  assert.equal(card.status, "completed");
  assert.equal(card.source, "github");
  assert.deepEqual(card.finding_kinds, ["vulnerability"]);
  assert.deepEqual(card.finding_severities, ["high"]);
  assert.deepEqual(card.evidence_ids, ["ev:1"]);
});

test("clipFactCard enforces enums bounds and control-free ids", () => {
  const card = clipFactCard({
    scan_id: "as_abc",
    status: "bogus",
    source: "zip",
    remediation_status: "done",
    package: {
      id: `pkg:npm/foo@1.0.0#${"n".repeat(600)}`,
      name: "foo\u0001",
      version: "1.0.0",
    },
    evidence_ids: Array.from({ length: 120 }, (_, index) => `ev:${index}`),
  });

  assert.equal(card.status, undefined);
  assert.equal(card.source, undefined);
  assert.equal(card.remediation_status, undefined);
  assert.equal(card.package?.id, undefined);
  assert.equal(card.package?.name, undefined);
  assert.equal(card.package?.version, "1.0.0");
  assert.equal(card.evidence_ids, undefined);
});

test("clipFactCard rejects oversized scalar and evidence strings instead of truncating", () => {
  const oversizedEvidenceId = `ev:${"x".repeat(600)}`;
  const card = clipFactCard({
    scan_id: "a".repeat(300),
    package: {
      name: "b".repeat(300),
      version: "1.0.0",
    },
    evidence_ids: [oversizedEvidenceId, "ev:1"],
  });

  assert.equal(card.scan_id, undefined);
  assert.equal(card.package?.name, undefined);
  assert.equal(card.package?.version, "1.0.0");
  assert.deepEqual(card.evidence_ids, ["ev:1"]);
  assert.notEqual(card.evidence_ids?.[0], oversizedEvidenceId.slice(0, 512));
});

test("deterministicAskText states unknowns and disclaims safe patch", () => {
  const card = clipFactCard({
    scan_id: "scan-1",
    status: "completed",
    summary: {
      risk: 0.72,
      trust: null,
      confidence: null,
      packages: 12,
    },
    verified: false,
  });

  const text = deterministicAskText(card);

  assert.match(text, /unknown/i);
  assert.doesNotMatch(text, /safe patch/i);
  assert.match(
    text,
    /Unknown is not safe\. This is not a verified patch\./,
  );
});

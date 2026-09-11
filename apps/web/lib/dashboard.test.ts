import assert from "node:assert/strict";
import test from "node:test";
import {
  clampListLimit,
  elapsedSeconds,
  filterScans,
  liveScans,
  metricLabel,
  relativeTime,
  rerunPayload,
  riskRows,
  selectFinding,
  sortUsage,
} from "./dashboard.ts";
import type { Finding } from "./types.ts";

const findings: Finding[] = [
  { id: "f1", package_id: "pkg-a", kind: "vuln", title: "A", severity: "high", evidence_ids: ["e1"] },
  { id: "f2", package_id: "pkg-b", kind: "vuln", title: "B", severity: "low", evidence_ids: ["e2"] },
];

test("selectFinding honors finding id then package instance", () => {
  assert.equal(selectFinding(findings, { finding: "f2" })?.id, "f2");
  assert.equal(selectFinding(findings, { package: "pkg-b" })?.id, "f2");
  assert.equal(selectFinding(findings, {})?.id, "f1");
});

test("metricLabel never turns missing into zero", () => {
  assert.equal(metricLabel(undefined), "unknown");
  assert.equal(metricLabel(null), "unknown");
  assert.equal(metricLabel(0), "0");
  assert.equal(metricLabel(58), "58");
});

test("list limit clamps to the public API budget", () => {
  assert.equal(clampListLimit(null), 50);
  assert.equal(clampListLimit("1"), 1);
  assert.equal(clampListLimit("500"), 200);
});

test("live rail is queued and running only", () => {
  assert.deepEqual(
    liveScans([
      { id: "a", source: "demo", status: "running", created_at: "", updated_at: "", progress: 10 },
      { id: "b", source: "demo", status: "completed", created_at: "", updated_at: "", progress: 100 },
      { id: "c", source: "demo", status: "queued", created_at: "", updated_at: "", progress: 0 },
    ]).map((s) => s.id),
    ["a", "c"],
  );
});

const base = { source: "demo", created_at: "2026-09-11T20:30:00Z", updated_at: "2026-09-11T20:30:00Z", progress: 100 };

test("filterScans matches status and id/repository search", () => {
  const scans = [
    { ...base, id: "as_aaa", status: "completed", summary: { risk: 12 } },
    { ...base, id: "as_bbb", status: "failed", source: "github", repository: "https://github.com/org/Repo" },
  ];
  assert.deepEqual(filterScans(scans, "all", "").map((s) => s.id), ["as_aaa", "as_bbb"]);
  assert.deepEqual(filterScans(scans, "failed", "").map((s) => s.id), ["as_bbb"]);
  assert.deepEqual(filterScans(scans, "all", "REPO").map((s) => s.id), ["as_bbb"]);
  assert.deepEqual(filterScans(scans, "completed", "bbb"), []);
});

test("relative time and elapsed never fake a value for bad dates", () => {
  const now = Date.parse("2026-09-11T20:31:30Z");
  assert.equal(elapsedSeconds("2026-09-11T20:31:00Z", now), 30);
  assert.equal(elapsedSeconds("nope", now), null);
  assert.equal(relativeTime("2026-09-11T20:31:00Z", now), "30s ago");
  assert.equal(relativeTime("2026-09-11T20:00:00Z", now), "31m ago");
  assert.equal(relativeTime("2026-09-10T20:00:00Z", now), "1d ago");
  assert.equal(relativeTime("", now), "unknown");
});

test("sortUsage orders by count and hides unused unless asked", () => {
  const ep = (path: string, count: number) => ({
    method: "GET",
    path,
    description: "",
    auth: true,
    usage: { count, errors: 0, last_status: 200, last_seen: null, avg_ms: 1 },
  });
  const list = [ep("/a", 0), ep("/b", 5), ep("/c", 9)];
  assert.deepEqual(sortUsage(list, false).map((e) => e.path), ["/c", "/b"]);
  assert.deepEqual(sortUsage(list, true).map((e) => e.path), ["/c", "/b", "/a"]);
});

test("riskRows keeps unknown risk as null and only finished scans", () => {
  const rows = riskRows([
    { ...base, id: "as_111111111111xyz", status: "completed", summary: { risk: 40 } },
    { ...base, id: "as_2", status: "running" },
    { ...base, id: "as_3", status: "partial" },
  ]);
  assert.deepEqual(rows, [
    { id: "as_111111111", risk: 40 },
    { id: "as_3", risk: null },
  ]);
});

test("rerunPayload only re-queues sources whose inputs core still has", () => {
  assert.deepEqual(rerunPayload({ ...base, id: "a", status: "failed" }), { source: "demo" });
  assert.deepEqual(rerunPayload({ ...base, id: "b", status: "failed", source: "github", repository: "https://x/y" }), {
    source: "github",
    repository: "https://x/y",
  });
  assert.equal(rerunPayload({ ...base, id: "c", status: "failed", source: "lockfile" }), null);
});

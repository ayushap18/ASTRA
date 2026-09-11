import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeUtterance } from "./sanitize.ts";

test("sanitizeUtterance removes secrets, userinfo URLs, and newlines", () => {
  const raw =
    "explain Bearer abc.def sk_secret ghp_aaaa github_pat_bbbb https://u:p@github.com/acme/app why\nrisk";
  const result = sanitizeUtterance(raw);

  assert.doesNotMatch(result, /Bearer/i);
  assert.doesNotMatch(result, /abc\.def/);
  assert.doesNotMatch(result, /sk_secret/);
  assert.doesNotMatch(result, /ghp_aaaa/);
  assert.doesNotMatch(result, /github_pat_bbbb/);
  assert.doesNotMatch(result, /u:p@/);
  assert.doesNotMatch(result, /\n/);
  assert.match(result, /explain/);
  assert.match(result, /why/);
  assert.match(result, /risk/);
});

test("sanitizeUtterance caps output at 500 characters", () => {
  const raw = "a".repeat(800);
  const result = sanitizeUtterance(raw);

  assert.ok(result.length <= 500);
});

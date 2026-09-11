export type VoicePackage = { id: string; name: string; version: string };
export type VoiceScan = { id: string; repository?: string };
export type VoiceContext = {
  pathname: string;
  scanId?: string;
  scanStatus?: string;
  packages: VoicePackage[];
  scans: VoiceScan[];
};
export type VoiceCommand =
  | { type: "list" }
  | { type: "open_scan"; scanId: string }
  | { type: "start_demo" }
  | { type: "start_github"; repository: string }
  | { type: "handoff_allot"; reason: "github_form" | "zip" }
  | { type: "simulate"; packageId: string }
  | { type: "simulate_riskiest" }
  | { type: "simulate_ambiguous"; candidates: VoicePackage[] }
  | { type: "simulate_missing" }
  | { type: "not_ready"; action: "simulate" | "remediate" }
  | { type: "remediate"; maxChanges: number }
  | { type: "verify_handoff" }
  | { type: "refuse"; reason: "exploit" | "safe_patch" | "source" | "secret" }
  | { type: "ask" };

const CANONICAL_GITHUB =
  /https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\.git)?(?![/?#])/i;

const REFUSE_EXPLOIT = /exploit|poc|proof of concept/i;
const REFUSE_SAFE_PATCH = /patch safe|verified safe|safe to ship|safe patch/i;
const REFUSE_SOURCE = /dump (the )?source|show source file/i;
const REFUSE_SECRET =
  /\bghp_|\bgithub_pat_|\bsk_[a-z0-9]|Bearer\s+\S/i;

const ZIP_HANDOFF = /\b(zip|lockfile)\b/i;
const DEMO = /demo scan|start (a )?demo/i;
const LIST = /list scans|queue status|how many scans/i;
const OPEN_SCAN_ID = /\b(as_[a-f0-9]+)\b/i;
const VERIFY = /\bverify\b|isolated test|run (the )?build/i;
const REMEDIATE = /remediat|fix plan|propose( \w+)? changes|propose (a )?fix/i;
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
const RISKIEST = /riskiest|highest risk|worst/i;
const SIMULATE = /simulate|attack|compromise/i;
const GITHUB_INTENT = /\bgithub\b|github\.com/i;
const GITHUB_START = /\bscan\b/i;
const GITHUB_START_PHRASE = /start\s+(a\s+)?github/i;

function scanReady(status: string | undefined): boolean {
  return status === "completed" || status === "partial";
}

export function clampChanges(n: number): number {
  return Math.min(100, Math.max(1, n));
}

function parseMaxChanges(transcript: string): number {
  const match = transcript.match(/(\d+|[a-z]+)\s*changes?/i);
  if (!match) return 3;
  const digits = Number.parseInt(match[1], 10);
  const n = Number.isNaN(digits) ? NUMBER_WORDS[match[1].toLowerCase()] : digits;
  return n === undefined ? 3 : clampChanges(n);
}

export function githubRepositoryFromTranscript(
  transcript: string,
): string | null {
  const match = transcript.match(CANONICAL_GITHUB);
  if (!match) return null;
  return `https://github.com/${match[1]}/${match[2]}`;
}

function refuseReason(
  transcript: string,
): Extract<VoiceCommand, { type: "refuse" }>["reason"] | null {
  if (REFUSE_EXPLOIT.test(transcript)) return "exploit";
  if (REFUSE_SAFE_PATCH.test(transcript)) return "safe_patch";
  if (REFUSE_SOURCE.test(transcript)) return "source";
  if (REFUSE_SECRET.test(transcript)) return "secret";
  return null;
}

function matchOpenScan(
  transcript: string,
  scans: VoiceScan[],
): VoiceCommand | null {
  const idMatch = transcript.match(OPEN_SCAN_ID);
  if (idMatch) {
    const scanId = idMatch[1].toLowerCase();
    const found = scans.find((s) => s.id.toLowerCase() === scanId);
    if (found) return { type: "open_scan", scanId: found.id };
  }

  if (
    githubRepositoryFromTranscript(transcript) &&
    !/\bopen\b/i.test(transcript)
  ) {
    return null;
  }

  const lower = transcript.toLowerCase();
  const hits = scans.filter((s) => {
    if (!s.repository) return false;
    return lower.includes(s.repository.toLowerCase().replace(/\.git$/, ""));
  });

  if (hits.length === 1) return { type: "open_scan", scanId: hits[0].id };

  const fragmentHits = scans.filter((s) => {
    if (!s.repository) return false;
    const parts = s.repository.replace(/\.git$/, "").split("/");
    const repoName = parts[parts.length - 1]?.toLowerCase();
    return repoName ? lower.includes(repoName) : false;
  });

  if (fragmentHits.length === 1) {
    return { type: "open_scan", scanId: fragmentHits[0].id };
  }

  return null;
}

function packageToken(transcript: string): string | null {
  const match = transcript.match(
    /(?:simulate|attack|compromise)\s+(?:package\s+)?(\S+)/i,
  );
  return match ? match[1].replace(/[.,!?]+$/, "") : null;
}

export function resolvePackage(
  token: string,
  packages: VoicePackage[],
): VoiceCommand | null {
  const atIdx = token.indexOf("@");
  if (atIdx > 0) {
    const name = token.slice(0, atIdx);
    const version = token.slice(atIdx + 1);
    const exact = packages.filter(
      (p) =>
        p.name.toLowerCase() === name.toLowerCase() &&
        p.version.toLowerCase() === version.toLowerCase(),
    );
    if (exact.length === 1) {
      return { type: "simulate", packageId: exact[0].id };
    }
    if (exact.length > 1) {
      return { type: "simulate_ambiguous", candidates: exact };
    }
    return { type: "simulate_missing" };
  }

  const byName = packages.filter(
    (p) => p.name.toLowerCase() === token.toLowerCase(),
  );
  if (byName.length === 1) {
    return { type: "simulate", packageId: byName[0].id };
  }
  if (byName.length > 1) {
    return { type: "simulate_ambiguous", candidates: byName };
  }
  return { type: "simulate_missing" };
}

export function parseVoiceCommand(
  transcript: string,
  ctx: VoiceContext,
): VoiceCommand {
  const text = transcript.trim();
  if (!text) return { type: "ask" };

  const refuse = refuseReason(text);
  if (refuse) return { type: "refuse", reason: refuse };

  if (ZIP_HANDOFF.test(text) && /\b(upload|scan|project)\b/i.test(text)) {
    return { type: "handoff_allot", reason: "zip" };
  }

  const repo = githubRepositoryFromTranscript(text);
  const githubStart =
    GITHUB_START.test(text) || GITHUB_START_PHRASE.test(text);
  const githubScan =
    !repo &&
    ((GITHUB_INTENT.test(text) && GITHUB_START.test(text)) ||
      GITHUB_START_PHRASE.test(text));
  if (repo && githubStart) {
    return { type: "start_github", repository: repo };
  }
  if (githubScan) {
    return { type: "handoff_allot", reason: "github_form" };
  }

  if (DEMO.test(text)) return { type: "start_demo" };
  if (LIST.test(text)) return { type: "list" };

  const open = matchOpenScan(text, ctx.scans);
  if (open) return open;

  if (VERIFY.test(text)) return { type: "verify_handoff" };

  if (REMEDIATE.test(text)) {
    if (!scanReady(ctx.scanStatus)) {
      return { type: "not_ready", action: "remediate" };
    }
    return { type: "remediate", maxChanges: parseMaxChanges(text) };
  }

  if (SIMULATE.test(text)) {
    if (!scanReady(ctx.scanStatus)) {
      return { type: "not_ready", action: "simulate" };
    }
    if (RISKIEST.test(text)) return { type: "simulate_riskiest" };
    const token = packageToken(text);
    if (token) return resolvePackage(token, ctx.packages) ?? { type: "ask" };
    return { type: "simulate_missing" };
  }

  return { type: "ask" };
}

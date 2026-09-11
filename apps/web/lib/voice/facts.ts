const GITHUB_REPO =
  /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/;

export const MAX_SCALAR_STRING = 256;
export const MAX_ID_STRING = 512;
export const MAX_EVIDENCE_IDS = 100;
export const EVIDENCE_LIMIT_WARNING =
  "Evidence references omitted because the voice limit was exceeded.";

const VALID_STATUS = new Set([
  "queued",
  "running",
  "completed",
  "partial",
  "failed",
]);
const VALID_SOURCE = new Set(["demo", "github", "lockfile"]);
const VALID_REMEDIATION_STATUS = new Set(["proposal", "verified", "failed"]);

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
const SINGLE_TOKEN = /^[^\s\u0000-\u001F\u007F]+$/;
const EVIDENCE_ID = /^ev:[^\s\u0000-\u001F\u007F]+$/;

export type VoiceFactSummary = {
  risk?: number | null;
  trust?: number | null;
  confidence?: number | null;
  packages?: number | null;
  direct?: number | null;
  transitive?: number | null;
  import_observed?: number | null;
  execution_proven?: number | null;
  findings?: number | null;
};

export type VoiceFactPackage = {
  id?: string;
  name?: string;
  version?: string;
  depth?: number;
  reachability_level?: string;
  reachability_status?: string;
};

export type VoiceFactCard = {
  scan_id?: string;
  status?: string;
  source?: string;
  repository?: string;
  summary?: VoiceFactSummary;
  package?: VoiceFactPackage;
  finding_kinds?: string[];
  finding_severities?: string[];
  evidence_ids?: string[];
  vulnerability_count?: number;
  verified?: boolean;
  remediation_status?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ownValue(
  record: Record<string, unknown>,
  key: string,
): unknown | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readNullableNumber(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }
  return readNumber(value);
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function clipBoundedString(
  value: string,
  max: number,
  allowWhitespace = true,
): string | undefined {
  if (CONTROL_CHARS.test(value)) {
    return undefined;
  }
  if (!allowWhitespace && !SINGLE_TOKEN.test(value)) {
    return undefined;
  }
  if (value.length > max) {
    return undefined;
  }
  return value;
}

function clipScalarString(value: unknown): string | undefined {
  const raw = readString(value);
  if (raw === undefined) {
    return undefined;
  }
  return clipBoundedString(raw, MAX_SCALAR_STRING);
}

function clipIdString(value: unknown): string | undefined {
  const raw = readString(value);
  if (raw === undefined) {
    return undefined;
  }
  return clipBoundedString(raw, MAX_ID_STRING);
}

function clipTokenString(value: unknown, max = MAX_SCALAR_STRING): string | undefined {
  const raw = readString(value);
  if (raw === undefined) {
    return undefined;
  }
  return clipBoundedString(raw, max, false);
}

function clipEvidenceId(value: unknown): string | undefined {
  const raw = readString(value);
  if (raw === undefined) {
    return undefined;
  }
  const bounded = clipBoundedString(raw, MAX_ID_STRING, false);
  if (bounded === undefined || !EVIDENCE_ID.test(bounded)) {
    return undefined;
  }
  return bounded;
}

function clipTokenArray(
  value: unknown,
  clipItem: (item: unknown) => string | undefined,
): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items: string[] = [];
  for (const item of value) {
    if (items.length >= MAX_EVIDENCE_IDS) {
      break;
    }
    const clipped = clipItem(item);
    if (clipped !== undefined) {
      items.push(clipped);
    }
  }
  return items.length > 0 ? items : undefined;
}

function clipEvidenceIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  if (value.length > MAX_EVIDENCE_IDS) {
    return undefined;
  }
  const items: string[] = [];
  for (const item of value) {
    const clipped = clipEvidenceId(item);
    if (clipped !== undefined) {
      items.push(clipped);
    }
  }
  return items.length > 0 ? items : undefined;
}

export function evidenceIdsLimitExceeded(input: unknown): boolean {
  if (!isRecord(input)) {
    return false;
  }
  const raw = ownValue(input, "evidence_ids");
  return Array.isArray(raw) && raw.length > MAX_EVIDENCE_IDS;
}

function readRepository(value: unknown): string | undefined {
  const repository = clipScalarString(value);
  if (repository === undefined || !GITHUB_REPO.test(repository)) {
    return undefined;
  }
  return repository;
}

function clipSummary(value: unknown): VoiceFactSummary | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const summary: VoiceFactSummary = {};
  const risk = readNullableNumber(ownValue(value, "risk"));
  const trust = readNullableNumber(ownValue(value, "trust"));
  const confidence = readNullableNumber(ownValue(value, "confidence"));
  const packages = readNullableNumber(ownValue(value, "packages"));
  const direct = readNullableNumber(ownValue(value, "direct"));
  const transitive = readNullableNumber(ownValue(value, "transitive"));
  const importObserved = readNullableNumber(ownValue(value, "import_observed"));
  const executionProven = readNullableNumber(ownValue(value, "execution_proven"));
  const findings = readNullableNumber(ownValue(value, "findings"));

  if (risk !== undefined) summary.risk = risk;
  if (trust !== undefined) summary.trust = trust;
  if (confidence !== undefined) summary.confidence = confidence;
  if (packages !== undefined) summary.packages = packages;
  if (direct !== undefined) summary.direct = direct;
  if (transitive !== undefined) summary.transitive = transitive;
  if (importObserved !== undefined) summary.import_observed = importObserved;
  if (executionProven !== undefined) summary.execution_proven = executionProven;
  if (findings !== undefined) summary.findings = findings;

  return Object.keys(summary).length > 0 ? summary : undefined;
}

function clipPackage(value: unknown): VoiceFactPackage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const pkg: VoiceFactPackage = {};
  const id = clipIdString(ownValue(value, "id"));
  const name = clipScalarString(ownValue(value, "name"));
  const version = clipScalarString(ownValue(value, "version"));
  const depth = readNumber(ownValue(value, "depth"));
  const reachabilityLevel = clipScalarString(ownValue(value, "reachability_level"));
  const reachabilityStatus = clipScalarString(ownValue(value, "reachability_status"));

  if (id !== undefined) pkg.id = id;
  if (name !== undefined) pkg.name = name;
  if (version !== undefined) pkg.version = version;
  if (depth !== undefined) pkg.depth = depth;
  if (reachabilityLevel !== undefined) pkg.reachability_level = reachabilityLevel;
  if (reachabilityStatus !== undefined) pkg.reachability_status = reachabilityStatus;

  return Object.keys(pkg).length > 0 ? pkg : undefined;
}

function clipEnumString(
  value: unknown,
  allowed: Set<string>,
): string | undefined {
  const raw = clipScalarString(value);
  if (raw === undefined || !allowed.has(raw)) {
    return undefined;
  }
  return raw;
}

export function clipFactCard(input: unknown): VoiceFactCard {
  if (!isRecord(input)) {
    return {};
  }

  const card: VoiceFactCard = {};
  const scanId = clipScalarString(ownValue(input, "scan_id"));
  const status = clipEnumString(ownValue(input, "status"), VALID_STATUS);
  const source = clipEnumString(ownValue(input, "source"), VALID_SOURCE);
  const repository = readRepository(ownValue(input, "repository"));
  const summary = clipSummary(ownValue(input, "summary"));
  const pkg = clipPackage(ownValue(input, "package"));
  const findingKinds = clipTokenArray(ownValue(input, "finding_kinds"), clipTokenString);
  const findingSeverities = clipTokenArray(
    ownValue(input, "finding_severities"),
    clipTokenString,
  );
  const evidenceIds = clipEvidenceIds(ownValue(input, "evidence_ids"));
  const vulnerabilityCount = readNumber(ownValue(input, "vulnerability_count"));
  const verified = readBoolean(ownValue(input, "verified"));
  const remediationStatus = clipEnumString(
    ownValue(input, "remediation_status"),
    VALID_REMEDIATION_STATUS,
  );

  if (scanId !== undefined) card.scan_id = scanId;
  if (status !== undefined) card.status = status;
  if (source !== undefined) card.source = source;
  if (repository !== undefined) card.repository = repository;
  if (summary !== undefined) card.summary = summary;
  if (pkg !== undefined) card.package = pkg;
  if (findingKinds !== undefined) card.finding_kinds = findingKinds;
  if (findingSeverities !== undefined) card.finding_severities = findingSeverities;
  if (evidenceIds !== undefined) card.evidence_ids = evidenceIds;
  if (vulnerabilityCount !== undefined) card.vulnerability_count = vulnerabilityCount;
  if (verified !== undefined) card.verified = verified;
  if (remediationStatus !== undefined) card.remediation_status = remediationStatus;

  return card;
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "unknown";
  }
  return String(value);
}

export function deterministicAskText(card: VoiceFactCard): string {
  const lines: string[] = [];

  lines.push(`Scan ${card.scan_id ?? "unknown"}.`);
  lines.push(`Status ${card.status ?? "unknown"}.`);

  if (card.summary) {
    lines.push(`Risk ${formatNumber(card.summary.risk)}.`);
    lines.push(`Trust ${formatNumber(card.summary.trust)}.`);
    lines.push(`Confidence ${formatNumber(card.summary.confidence)}.`);
    lines.push(`Packages ${formatNumber(card.summary.packages)}.`);
    lines.push(`Direct ${formatNumber(card.summary.direct)}.`);
    lines.push(`Transitive ${formatNumber(card.summary.transitive)}.`);
    lines.push(`Import observed ${formatNumber(card.summary.import_observed)}.`);
    lines.push(`Execution proven ${formatNumber(card.summary.execution_proven)}.`);
    lines.push(`Findings ${formatNumber(card.summary.findings)}.`);
  }

  if (card.package) {
    lines.push(`Package ${card.package.name ?? "unknown"}.`);
  }

  lines.push(
    `Verified ${card.verified === undefined ? "unknown" : String(card.verified)}.`,
  );
  lines.push("Unknown is not safe. This is not a verified patch.");

  return lines.join(" ");
}

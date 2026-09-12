export type ScanCreated = { scan_id: string; status: string; events_url: string };

export type ScanEvent = {
  id: number;
  type: string;
  stage: string;
  progress: number;
  message: string;
  time: string;
};

/** Per-goal counts. Every count derives only from evidence; a missing block means "not analysed", never 0. */
export type GoalCounts = {
  tree?: { direct: number; transitive: number; max_depth: number };
  vulnerabilities?: { total: number; reachable: number; unknown_reach: number };
  outdated?: { total: number; major: number; minor: number; patch: number };
  suspicious?: { maintainer_changes: number; version_jumps: number; install_scripts: number };
  license?: { conflicts: number; denied: number; unknown: number };
  concentration?: { top_maintainer: string; top_maintainer_share: number; unmaintained: number };
};

export type AnalysisSummary = {
  risk?: number;
  trust?: number;
  confidence?: number;
  packages?: number;
  findings?: number;
  aggregation?: string;
  goals?: GoalCounts;
};

export type Scan = {
  id: string;
  source: string;
  repository?: string;
  status: string;
  created_at: string;
  updated_at: string;
  events: ScanEvent[];
  error?: string;
  analysis?: { summary?: AnalysisSummary; limitations?: string[] };
};

export type UpgradeEffort = "patch" | "minor" | "major";

export type Finding = {
  id: string;
  package_id: string;
  /** Includes "outdated", "maintainer_change", "version_jump", "license_conflict", "unmaintained", "lifecycle_capabilities" (install-time scripts). */
  kind: string;
  title: string;
  severity: string;
  evidence_ids: string[];
  upgrade_effort?: UpgradeEffort; // kind "outdated"
  upgrade_note?: string; // kind "outdated"
  advisory_id?: string;
  reachability?: string;
};

/**
 * Registry metadata. Defaults mean unknown, never a measurement:
 * latest_published_at "" · *_gap 0 (registry_status tells unknown from current) ·
 * days_since_latest_publish -1 · previous_maintainers [] · version_jump_note "".
 */
export type PackageMetadata = {
  registry_status?: string;
  osv_status?: string;
  latest_version?: string;
  maintainers?: string[];
  published_at?: string;
  has_install_script?: boolean;
  latest_published_at?: string;
  major_gap?: number;
  minor_gap?: number;
  patch_gap?: number;
  days_since_latest_publish?: number;
  maintainer_changed?: boolean;
  previous_maintainers?: string[];
  version_jump?: boolean;
  version_jump_note?: string;
};

export type GraphPackage = {
  id: string;
  name: string;
  version: string;
  purl: string;
  depth: number;
  direct: boolean;
  license?: string;
  metadata?: PackageMetadata;
  /** dimensions "maintenance" / "maintainer" are numbers only when evidence exists, else null. */
  risk?: { score?: number; confidence?: number; dimensions?: Record<string, number | null> };
};

export type GraphEdge = {
  source: string;
  target: string;
  scope: string;
};

export type Evidence = {
  id: string;
  kind: string;
  source: string;
  summary: string;
  location?: string;
  sha256?: string;
  confidence: number;
};

export type Graph = {
  root_id: string;
  /** Root package.json license; "" when unknown. */
  project_license?: string;
  packages: GraphPackage[];
  edges: GraphEdge[];
  evidence: Evidence[];
  warnings: string[];
};

export type Explanation = {
  text: string;
  provider: string;
  language: string;
  requested_language: string;
  evidence_ids: string[];
  ai_generated: boolean;
  warnings: string[];
};

export type Simulation = {
  origin: string;
  toxicity_radius: number;
  model_version: string;
  factors: Record<string, number>;
  affected_packages: string[];
  installed_packages: number;
  dependency_paths: string[][];
  path_semantics: string;
  propagation: { source: string; target: string }[];
  secret_exposure_potential: Record<string, string>;
  assumptions: {
    ci_install: boolean;
    lifecycle_scripts_enabled: boolean;
    credential_categories: string[];
    observed_install_script: boolean;
  };
  evidence_ids: string[];
  limitations: string[];
};

export type RemediationChange = {
  package_id: string;
  package: string;
  from: string;
  to: string;
  finding_ids: string[];
  action: string;
  verified: boolean;
  major_change: boolean;
  evidence_ids: string[];
};

export type Remediation = {
  status: string;
  verified: boolean;
  current_risk: number;
  predicted_risk: number | null;
  potentially_addressed_findings: number;
  total_findings: number;
  remaining_finding_ids: string[];
  changes: RemediationChange[];
  verification_required: string[];
  limitations: string[];
  verification?: {
    passed?: boolean;
    install_ok?: boolean;
    scripts?: string[];
    commands?: { name: string; exit: number; stdout_sha256: string; stderr_sha256: string }[];
  };
};

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const body = init?.body;
  if (body && !(body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, { ...init, headers });
  const parsed = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = parsed?.error?.message ?? `Request failed (${response.status})`;
    throw new Error(message);
  }
  return parsed as T;
}

export type EndpointUsage = {
  method: string;
  path: string;
  description: string;
  auth: boolean;
  usage: { count: number; errors: number; last_status: number; last_seen: string | null; avg_ms: number };
};

export type CoreStatus = {
  service: string;
  version: string;
  uptime_seconds: number;
  config: {
    demo_enabled: boolean;
    github_enabled: boolean;
    verifier_configured: boolean;
    storage: string;
    queue: { workers: number; capacity: number; running: number; queued: number };
  };
  dependencies: {
    store: { ok: boolean; error?: string };
    intelligence: { ok: boolean; error?: string };
    sarvam: { configured: boolean };
  };
  endpoints: EndpointUsage[];
};

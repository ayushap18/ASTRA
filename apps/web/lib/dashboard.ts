import type { AnalysisSummary, EndpointUsage, Finding } from "./types.ts";
import type { InvestigationQuery } from "./investigation.ts";

export type ScanSummary = {
  id: string;
  source: string;
  repository?: string;
  status: string;
  created_at: string;
  updated_at: string;
  error?: string;
  summary?: AnalysisSummary;
  stage?: string;
  progress: number;
  message?: string;
};

export function clampListLimit(raw: string | null): number {
  if (raw == null || raw === "") return 50;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return 50;
  return Math.min(n, 200);
}

export function selectFinding(findings: Finding[], query: InvestigationQuery): Finding | undefined {
  if (query.finding) {
    const exact = findings.find((item) => item.id === query.finding);
    if (exact) return exact;
  }
  if (query.package) {
    return findings.find((item) => item.package_id === query.package);
  }
  return findings[0];
}

export function metricLabel(value: number | null | undefined): string {
  return value == null || Number.isNaN(value) ? "unknown" : String(value);
}

export function liveScans(scans: ScanSummary[]): ScanSummary[] {
  return scans.filter((scan) => scan.status === "queued" || scan.status === "running");
}

export const SCAN_STATUSES = ["all", "queued", "running", "completed", "partial", "failed"] as const;

export function filterScans(scans: ScanSummary[], status: string, query: string): ScanSummary[] {
  const q = query.trim().toLowerCase();
  return scans.filter(
    (scan) =>
      (status === "all" || scan.status === status) &&
      (!q || `${scan.id} ${scan.source} ${scan.repository ?? ""}`.toLowerCase().includes(q)),
  );
}

export function elapsedSeconds(iso: string, now: number): number | null {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((now - t) / 1000));
}

export function relativeTime(iso: string, now: number): string {
  const s = elapsedSeconds(iso, now);
  if (s == null) return "unknown";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function sortUsage(endpoints: EndpointUsage[], showUnused: boolean): EndpointUsage[] {
  return endpoints
    .filter((e) => showUnused || e.usage.count > 0)
    .slice()
    .sort((a, b) => b.usage.count - a.usage.count || a.path.localeCompare(b.path));
}

export function riskRows(scans: ScanSummary[], limit = 8): { id: string; risk: number | null }[] {
  return scans
    .filter((scan) => scan.status === "completed" || scan.status === "partial")
    .slice(0, limit)
    .map((scan) => ({ id: scan.id.slice(0, 12), risk: scan.summary?.risk ?? null }));
}

/** Body for POST /api/v1/scans that re-queues this scan, or null when raw inputs were not stored. */
export function rerunPayload(scan: ScanSummary): Record<string, string> | null {
  if (scan.source === "demo") return { source: "demo" };
  if (scan.source === "github" && scan.repository) return { source: "github", repository: scan.repository };
  return null;
}

import { coreHeaders } from "@/lib/core";
import type { ScanSummary } from "@/lib/dashboard";
import type { AnalysisSummary, Evidence, Finding, Graph, Scan } from "@/lib/types";

const CORE = process.env.ASTRA_CORE_URL ?? "http://127.0.0.1:8080";

export class CoreError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function coreGet(path: string) {
  const response = await fetch(`${CORE}${path}`, { headers: coreHeaders(), cache: "no-store" }).catch(() => null);
  if (!response) {
    throw new CoreError(503, "Astra core is not reachable");
  }
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

export async function listScans(status = "") {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  const { response, body } = await coreGet(`/api/v1/scans${query}`);
  if (!response.ok) throw new CoreError(response.status, body?.error?.message ?? "Scan list unavailable");
  return (body.scans ?? []) as ScanSummary[];
}

export async function getScan(id: string) {
  const { response, body } = await coreGet(`/api/v1/scans/${id}`);
  if (response.status === 404) throw new CoreError(404, "Scan does not exist");
  if (!response.ok) throw new CoreError(response.status, body?.error?.message ?? "Scan unavailable");
  return body as Scan;
}

export async function getFindings(id: string) {
  const { response, body } = await coreGet(`/api/v1/scans/${id}/findings`);
  if (response.status === 409) return { findings: [] as Finding[], summary: undefined as AnalysisSummary | undefined };
  if (!response.ok) throw new Error(body?.error?.message ?? "Findings unavailable");
  return body as { findings: Finding[]; summary: AnalysisSummary };
}

export async function getGraph(id: string) {
  const { response, body } = await coreGet(`/api/v1/scans/${id}/graph`);
  if (response.status === 409) return null;
  if (!response.ok) throw new Error(body?.error?.message ?? "Graph unavailable");
  return body as Graph;
}

export async function getEvidence(id: string) {
  const { response, body } = await coreGet(`/api/v1/scans/${id}/evidence`);
  if (response.status === 409) return [] as Evidence[];
  if (!response.ok) throw new Error(body?.error?.message ?? "Evidence unavailable");
  return (body.evidence ?? []) as Evidence[];
}

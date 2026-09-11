import type { Finding, Graph, GraphEdge, Scan } from "./types.ts";

export type InvestigationQuery = {
  package?: string;
  finding?: string;
};

export function parseInvestigationSearch(search: URLSearchParams | { package?: string; finding?: string }): InvestigationQuery {
  const packageId = "get" in search ? search.get("package") : search.package;
  const findingId = "get" in search ? search.get("finding") : search.finding;
  return {
    package: packageId?.trim() || undefined,
    finding: findingId?.trim() || undefined,
  };
}

export function investigationHref(pathname: string, query: InvestigationQuery): string {
  const params = new URLSearchParams();
  if (query.package) params.set("package", query.package);
  if (query.finding) params.set("finding", query.finding);
  const suffix = params.toString();
  return suffix ? `${pathname}?${suffix}` : pathname;
}

export function withInvestigationSearch(pathname: string, current: URLSearchParams): string {
  return investigationHref(pathname, parseInvestigationSearch(current));
}

/** Walk dependency parents (edge source depends on edge target). Ancestry, not execution. */
export function installAncestors(edges: GraphEdge[], packageId: string, maxDepth = 32): Set<string> {
  const parents = new Map<string, string[]>();
  for (const edge of edges) {
    const list = parents.get(edge.target) ?? [];
    list.push(edge.source);
    parents.set(edge.target, list);
  }
  const ancestors = new Set<string>();
  const queue: { id: string; depth: number }[] = [{ id: packageId, depth: 0 }];
  const seen = new Set([packageId]);
  while (queue.length) {
    const item = queue.shift();
    if (!item || item.depth >= maxDepth) continue;
    for (const parent of parents.get(item.id) ?? []) {
      if (seen.has(parent)) continue;
      seen.add(parent);
      ancestors.add(parent);
      queue.push({ id: parent, depth: item.depth + 1 });
    }
  }
  return ancestors;
}

export function workbenchExport(input: {
  scan: Scan;
  findings: Finding[];
  graph: Graph | null;
  exportedAt: string;
}) {
  return {
    product: "astra",
    kind: "workbench-export",
    exported_at: input.exportedAt,
    scan: {
      id: input.scan.id,
      source: input.scan.source,
      repository: input.scan.repository,
      status: input.scan.status,
      error: input.scan.error,
      analysis: input.scan.analysis,
    },
    findings: input.findings,
    graph: input.graph
      ? {
          root_id: input.graph.root_id,
          warnings: input.graph.warnings,
          packages: input.graph.packages,
          edges: input.graph.edges,
          evidence: input.graph.evidence,
        }
      : null,
    limitations: [
      "Export is a snapshot of stored evidence, not a verified patch or execution proof.",
      "Dependency ancestry is not an execution path.",
      "Source file bodies are not included.",
    ],
  };
}

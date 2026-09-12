import { Suspense } from "react";
import { Bars, Donut, Radar } from "@/components/charts";
import { FindingList } from "@/components/finding-list";
import { WorkbenchExport } from "@/components/workbench-export";
import { metricLabel } from "@/lib/dashboard";
import { getEvidence, getFindings, getGraph, getScan } from "@/lib/server";

export default async function OverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scan = await getScan(id);
  const { findings, summary } = await getFindings(id);
  const graph = await getGraph(id);
  const evidence = graph?.evidence ?? (await getEvidence(id).catch(() => []));
  const analysis = summary ?? scan.analysis?.summary;
  const failed = scan.status === "failed";
  const partial = scan.status === "partial";
  const byKind = new Map<string, number>();
  const bySeverity = new Map<string, number>();
  for (const finding of findings) {
    byKind.set(finding.kind, (byKind.get(finding.kind) ?? 0) + 1);
    bySeverity.set(finding.severity, (bySeverity.get(finding.severity) ?? 0) + 1);
  }
  const depths = new Map<number, number>();
  const dimensions: Record<string, number[]> = {};
  for (const pkg of graph?.packages ?? []) {
    depths.set(pkg.depth, (depths.get(pkg.depth) ?? 0) + 1);
    const dim = pkg.risk?.dimensions ?? {};
    for (const [key, value] of Object.entries(dim)) {
      if (value == null) continue;
      dimensions[key] = [...(dimensions[key] ?? []), value];
    }
  }
  const radar = Object.fromEntries(
    Object.entries(dimensions).map(([key, values]) => [key, Math.round(values.reduce((a, b) => a + b, 0) / values.length)]),
  );

  return (
    <main className="stack">
      <p className="eyebrow">
        {scan.source} · {scan.status}
      </p>
      <h1 className="headline">{scan.repository || scan.id}</h1>
      {failed ? (
        <section className="panel accent-navy stack">
          <p className="eyebrow">Scan failed</p>
          <p className="subhead">{scan.error || "The scan ended before analysis completed."}</p>
        </section>
      ) : (
        <section className="panel accent-lime stack">
          <p className="eyebrow">Overview</p>
          {partial ? (
            <div className="stack">
              <p className="body">Partial: usable with gaps.</p>
              {graph?.warnings.length ? (
                <ul className="warning-list">
                  {graph.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : (
                <p className="body">Warnings are listed on Graph.</p>
              )}
            </div>
          ) : null}
          <div className="chart-grid">
            <Donut value={analysis?.trust} label="Trust" tone="mint" />
            <Donut value={analysis?.risk} label="Risk" tone="coral" />
            <Donut value={analysis?.confidence} label="Confidence" tone="lilac" />
            {Object.keys(radar).length ? <Radar title="Mean risk dimensions" values={radar} /> : null}
            <Bars
              title="Findings by severity"
              bySeverity
              items={[...bySeverity.entries()].map(([label, value]) => ({ label, value }))}
            />
            <Bars title="Findings by kind" items={[...byKind.entries()].map(([label, value]) => ({ label, value }))} />
            <Bars
              title="Instances by depth"
              items={[...depths.entries()]
                .sort((a, b) => a[0] - b[0])
                .map(([depth, value]) => ({ label: `d${depth}`, value }))}
            />
          </div>
          <p className="body">
            Trust is 100 minus repository risk. Unknown stays {metricLabel(undefined)}. Numbers are heuristics.
          </p>
          <p className="caption">
            {analysis?.packages ?? graph?.packages.length ?? 0} packages · {analysis?.findings ?? findings.length}{" "}
            findings · {analysis?.aggregation ?? "pending"}
          </p>
        </section>
      )}
      <section className="panel stack">
        <h2 className="headline">Findings</h2>
        <WorkbenchExport scan={scan} findings={findings} graph={graph} />
        {findings.length === 0 ? (
          <p className="body">
            {scan.status === "completed" || scan.status === "partial"
              ? "No findings were recorded."
              : "Waiting for analysis."}
          </p>
        ) : (
          <Suspense fallback={<p className="caption">Loading findings…</p>}>
            <FindingList scanId={id} findings={findings} evidence={evidence} />
          </Suspense>
        )}
      </section>
    </main>
  );
}

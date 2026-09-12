import { Suspense } from "react";
import { GraphCanvas } from "@/components/graph-canvas";
import { WarningList } from "@/components/warning-list";
import { getGraph } from "@/lib/server";

export default async function GraphPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const graph = await getGraph(id);
  return (
    <main className="stack">
      <section className="panel accent-cream stack">
        <p className="eyebrow">Graph</p>
        <h1 className="headline">Installed package instances</h1>
        <p className="body">
          Node key is <code>id</code>, not package name. Same purl can appear more than once. This is topology, not
          execution.
        </p>
      </section>
      <section className="panel stack">
        {!graph ? (
          <p className="body">Graph is not available yet.</p>
        ) : (
          <>
            <WarningList warnings={graph.warnings} />
            <Suspense fallback={<p className="caption">Loading graph…</p>}>
              <GraphCanvas scanId={id} graph={graph} />
            </Suspense>
          </>
        )}
      </section>
    </main>
  );
}

import { AttackForm } from "@/components/attack-form";
import { getGraph, getScan } from "@/lib/server";

export default async function AttackPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ package?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const scan = await getScan(id);
  const graph = await getGraph(id);
  const ready = scan.status === "completed" || scan.status === "partial";
  return (
    <main className="stack">
      <section className="panel accent-coral stack">
        <p className="eyebrow">Attack</p>
        <h1 className="headline">Hypothetical compromise</h1>
        <p className="body">
          Choose an install instance <code>id</code>. Assumptions default off. Categories are labels, never secret
          values. Scripts are not executed.
        </p>
      </section>
      <section className="panel stack">
        <AttackForm
          scanId={id}
          ready={ready}
          packages={graph?.packages ?? []}
          initialPackageId={query.package}
        />
      </section>
    </main>
  );
}

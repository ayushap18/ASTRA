import { Skeleton } from "@/components/ui/skeleton";

export default function ScanLoading() {
  return (
    <main className="stack">
      <section className="panel accent-cream stack">
        <p className="eyebrow">Loading scan</p>
        <p className="headline">Fetching graph, findings, and evidence.</p>
        <Skeleton rows={6} />
      </section>
    </main>
  );
}

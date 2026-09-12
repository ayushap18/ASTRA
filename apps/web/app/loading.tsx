import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <main className="workspace stack">
      <section className="panel accent-cream stack">
        <p className="eyebrow">Loading console</p>
        <p className="headline">Fetching scans from core.</p>
        <Skeleton rows={5} />
      </section>
    </main>
  );
}

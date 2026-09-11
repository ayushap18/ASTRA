import { Skeleton } from "@/components/ui/skeleton";

export default function ScanLoading() {
  return (
    <main className="stack">
      <section className="panel">
        <Skeleton rows={6} />
      </section>
    </main>
  );
}

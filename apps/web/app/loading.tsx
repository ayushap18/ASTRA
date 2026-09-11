import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <main className="workspace stack">
      <section className="panel">
        <Skeleton rows={5} />
      </section>
    </main>
  );
}

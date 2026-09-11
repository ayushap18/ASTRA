import { RemediateForm } from "@/components/remediate-form";
import { getScan } from "@/lib/server";

export default async function RemediatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scan = await getScan(id);
  const ready = scan.status === "completed" || scan.status === "partial";
  return (
    <main className="stack">
      <section className="panel accent-mint stack">
        <p className="eyebrow">Remediate</p>
        <h1 className="headline">Proposals only</h1>
        <p className="body">
          Isolated test/build can set <code>verified: true</code> for that changeset only — not a safety claim. Demo
          scans cannot be verified.
        </p>
      </section>
      <section className="panel stack">
        <RemediateForm scanId={id} ready={ready} demo={scan.source === "demo"} />
      </section>
    </main>
  );
}

import type { Evidence } from "@/lib/types";

export function EvidenceStrip({ records }: { records: Evidence[] }) {
  if (!records.length) {
    return <p className="body-lg">No evidence records for this finding.</p>;
  }
  return (
    <section className="color-block pink stack">
      <p className="eyebrow">Evidence</p>
      {records.map((item) => (
        <article key={item.id} className="finding">
          <p className="caption">
            {item.id} · {item.kind} · {item.source} · confidence {item.confidence}
          </p>
          <p className="body-lg">{item.summary}</p>
          {item.location ? <p className="caption">{item.location}</p> : null}
        </article>
      ))}
    </section>
  );
}

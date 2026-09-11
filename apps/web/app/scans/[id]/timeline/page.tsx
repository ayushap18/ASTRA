import { getScan } from "@/lib/server";

export default async function TimelinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scan = await getScan(id);
  return (
    <main className="stack">
      <section className="panel accent-lilac stack">
        <p className="eyebrow">Timeline</p>
        <h1 className="headline">History is unavailable</h1>
        <p className="body">
          Current maintainers cannot establish ownership changes. The event-based trust timeline does not exist in this
          increment.
        </p>
      </section>
      <section className="panel stack">
        <h2 className="headline">This scan</h2>
        <p className="body">Stage events for this job only. This is not a maintainer trust timeline.</p>
        {scan.events.length === 0 ? <p className="body">No events yet.</p> : null}
        {scan.events.map((event) => (
          <article key={event.id} className="finding">
            <p className="caption">
              {event.type} · {event.stage} · {event.progress}%
            </p>
            <p className="body">{event.message}</p>
          </article>
        ))}
      </section>
    </main>
  );
}

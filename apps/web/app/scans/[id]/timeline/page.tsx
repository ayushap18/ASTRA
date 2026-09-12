import { getGraph, getScan } from "@/lib/server";
import type { GraphPackage } from "@/lib/types";

type Event = { at: string; pkg: string; title: string; detail?: string };

function registryEvents(packages: GraphPackage[]): Event[] {
  const events: Event[] = [];
  for (const pkg of packages) {
    const meta = pkg.metadata;
    if (!meta || meta.registry_status !== "available") continue;
    const name = `${pkg.name}@${pkg.version}`;
    if (meta.published_at) {
      events.push({ at: meta.published_at, pkg: name, title: "Installed version published" });
    }
    if (meta.maintainer_changed && meta.published_at) {
      events.push({
        at: meta.published_at,
        pkg: name,
        title: "Maintainer set changed from previous version",
        detail: `${(meta.previous_maintainers ?? []).join(", ") || "unknown"} → ${(meta.maintainers ?? []).join(", ") || "unknown"}`,
      });
    }
    if (meta.version_jump && meta.published_at) {
      events.push({ at: meta.published_at, pkg: name, title: "Unusual version jump", detail: meta.version_jump_note });
    }
    if (meta.latest_published_at && meta.latest_version && meta.latest_version !== pkg.version) {
      events.push({ at: meta.latest_published_at, pkg: name, title: `Latest version ${meta.latest_version} published` });
    }
  }
  return events.sort((a, b) => b.at.localeCompare(a.at));
}

export default async function TimelinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [scan, graph] = await Promise.all([getScan(id), getGraph(id)]);
  const packages = graph?.packages ?? [];
  const events = registryEvents(packages);
  const unavailable = packages.filter((p) => p.metadata?.registry_status !== "available").length;
  return (
    <main className="stack">
      <section className="panel accent-lilac stack">
        <p className="eyebrow">Timeline</p>
        <h1 className="headline">Registry history</h1>
        <p className="body">
          Publish dates and maintainer sets from the npm packument, compared only between the installed version and
          its adjacent published version. This is not a full ownership history.
          {unavailable ? ` Registry history unavailable for ${unavailable} of ${packages.length} packages.` : ""}
        </p>
        {events.length === 0 ? <p className="body">No registry history yet.</p> : null}
        <div className="scroll-list">
          {events.map((event, index) => (
            <article key={`${event.pkg}-${event.title}-${index}`} className="finding">
              <p className="caption">
                {event.at.slice(0, 10)} · {event.pkg}
              </p>
              <p className="body">{event.title}</p>
              {event.detail ? <p className="caption">{event.detail}</p> : null}
            </article>
          ))}
        </div>
      </section>
      <section className="panel stack">
        <h2 className="headline">This scan</h2>
        <p className="body">Stage events for this job only.</p>
        {scan.events.length === 0 ? <p className="body">No events yet.</p> : null}
        <div className="scroll-list">
          {scan.events.map((event) => (
            <article key={event.id} className="finding">
              <p className="caption">
                {event.type} · {event.stage} · {event.progress}%
              </p>
              <p className="body">{event.message}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

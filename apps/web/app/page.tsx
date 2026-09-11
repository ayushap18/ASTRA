import { Dashboard } from "@/components/dashboard";
import { ScanForm } from "@/components/scan-form";
import { listScans } from "@/lib/server";
import type { ScanSummary } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let scans: ScanSummary[] = [];
  let listError = "";
  try {
    scans = await listScans();
  } catch (err) {
    listError = err instanceof Error ? err.message : "Scan list unavailable";
  }
  return (
    <main className="workspace">
      <section className="hero">
        <p className="eyebrow">Astra operator console</p>
        <h1 className="display">Scans</h1>
        <p className="body">
          Queue npm lockfile investigations. Two scans run at a time; eighteen can wait. This is evidence work, not a
          verified-safe badge.
        </p>
      </section>
      {listError ? <p className="error">{listError}</p> : null}
      <Dashboard initialScans={scans} />
      <section id="scan" className="panel accent-lime stack">
        <p className="eyebrow">New scan</p>
        <h2 className="headline">Allot a job</h2>
        <ScanForm />
      </section>
    </main>
  );
}

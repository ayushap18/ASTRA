"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { VoiceControl } from "@/components/voice-control";
import { liveScans, type ScanSummary } from "@/lib/dashboard";

function statusTone(status: string) {
  if (status === "running") return "running";
  if (status === "queued") return "queued";
  if (status === "failed") return "failed";
  if (status === "partial") return "partial";
  return "done";
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [ready, setReady] = useState<boolean | null>(null);
  const [scans, setScans] = useState<ScanSummary[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/ready")
      .then((response) => setReady(response.ok))
      .catch(() => setReady(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const response = await fetch("/api/v1/scans", { cache: "no-store" }).catch(() => null);
      if (!response || cancelled) return;
      const body = await response.json().catch(() => ({ scans: [] }));
      if (!cancelled) setScans(body.scans ?? []);
    }
    load();
    const timer = setInterval(load, 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const live = liveScans(scans);
  const running = scans.filter((s) => s.status === "running").length;
  const queued = scans.filter((s) => s.status === "queued").length;
  const statusLabel = ready === null ? "checking" : ready ? "ready" : "down";

  return (
    <div className="console">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <aside className={`rail ${open ? "open" : ""}`}>
        <Link href="/" className="brand-mark" onClick={() => setOpen(false)}>
          ASTRA
        </Link>
        <p className="caption">Operator console</p>
        <nav className="scan-nav" aria-label="Scans">
          {scans.length === 0 ? <p className="caption">No scans yet</p> : null}
          {scans.map((scan) => {
            const href = `/scans/${scan.id}`;
            const current = path.startsWith(href);
            return (
              <Link
                key={scan.id}
                href={href}
                className="scan-link"
                aria-current={current ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                <span className={`status-dot ${statusTone(scan.status)}`} />
                <span>
                  <span className="mono-id">{scan.id.slice(0, 12)}</span>
                  <span className="caption">
                    {scan.status} · {scan.source}
                  </span>
                </span>
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="console-main">
        <header className="console-bar">
          <button type="button" className="pill secondary menu" onClick={() => setOpen((v) => !v)}>
            Scans
          </button>
          <span className="status-badge">
            <span className={`status-dot ${ready ? "done" : ready === false ? "failed" : "queued"}`} />
            <span className="caption">core {statusLabel}</span>
          </span>
          <span className="caption">
            {running} running · {queued} queued · {scans.length} total
          </span>
          <VoiceControl scans={scans} />
          <Link href="/#scan" className="pill primary">
            + Scan
          </Link>
        </header>
        {live.length ? (
          <div className="live-rail" aria-live="polite">
            {live.map((scan) => (
              <Link key={scan.id} href={`/scans/${scan.id}`} className="live-item">
                <span className="mono-id">{scan.id.slice(0, 10)}</span>
                <span className="live-track">
                  <span className="live-fill" style={{ width: `${Math.max(4, scan.progress)}%` }} />
                </span>
                <span className="caption">
                  {scan.stage || scan.status} · {scan.progress}%
                </span>
              </Link>
            ))}
          </div>
        ) : null}
        <div id="main">{children}</div>
      </div>
    </div>
  );
}

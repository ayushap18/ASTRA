"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  SCAN_STATUSES,
  elapsedSeconds,
  filterScans,
  liveScans,
  metricLabel,
  relativeTime,
  rerunPayload,
  riskRows,
  sortUsage,
  type ScanSummary,
} from "@/lib/dashboard";
import { api, type CoreStatus, type ScanCreated } from "@/lib/types";

function Widget({ title, wide, children }: { title: string; wide?: boolean; children: ReactNode }) {
  return (
    <section className={`panel widget stack-sm${wide ? " widget-wide" : ""}`}>
      <p className="eyebrow">{title}</p>
      {children}
    </section>
  );
}

function Dot({ ok }: { ok: boolean | null }) {
  return <span className={`status-dot ${ok == null ? "queued" : ok ? "done" : "failed"}`} />;
}

function label(ok: boolean | null, yes = "ok", no = "down") {
  return ok == null ? "unknown" : ok ? yes : no;
}

function usePoll<T>(path: string, ms: number, pick: (body: unknown) => T, initial: T): [T, boolean] {
  const [value, setValue] = useState(initial);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const response = await fetch(path, { cache: "no-store" }).catch(() => null);
      if (cancelled) return;
      if (!response?.ok) return setFailed(true);
      const body = await response.json().catch(() => null);
      if (cancelled || body == null) return setFailed(true);
      setFailed(false);
      setValue(pick(body));
    }
    load();
    const timer = setInterval(load, ms);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ms]);
  return [value, failed];
}

export function Dashboard({ initialScans }: { initialScans: ScanSummary[] }) {
  const [scans, scansFailed] = usePoll("/api/v1/scans", 2500, (b) => (b as { scans?: ScanSummary[] }).scans ?? [], initialScans);
  const [status, statusFailed] = usePoll<CoreStatus | null>("/api/v1/status", 5000, (b) => b as CoreStatus, null);
  const [now, setNow] = useState(() => Date.now());
  const [filter, setFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [showUnused, setShowUnused] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const s = statusFailed ? null : status;
  const live = liveScans(scans);
  const rows = filterScans(scans, filter, query);
  const usage = s ? sortUsage(s.endpoints, showUnused) : [];
  const maxCount = Math.max(1, ...usage.map((e) => e.usage.count));
  const risks = riskRows(scans);
  const q = s?.config.queue;

  async function queue(key: string, body: Record<string, string>) {
    setError("");
    setBusy(key);
    try {
      await api<ScanCreated>("/api/v1/scans", { method: "POST", body: JSON.stringify(body) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="dash-grid">
      <Widget title="System">
        <ul className="dash-list">
          <li><Dot ok={s ? s.dependencies.store.ok : null} /> core {label(s ? s.dependencies.store.ok : null, "ready")}</li>
          <li><Dot ok={s ? s.dependencies.intelligence.ok : null} /> intelligence {label(s ? s.dependencies.intelligence.ok : null)}</li>
          <li><Dot ok={s ? s.dependencies.sarvam.configured : null} /> sarvam {label(s ? s.dependencies.sarvam.configured : null, "configured", "not configured")}</li>
          <li><Dot ok={s ? s.config.verifier_configured : null} /> verifier {label(s ? s.config.verifier_configured : null, "configured", "not configured")}</li>
          <li className="caption">storage <span className="mono-id">{s?.config.storage ?? "unknown"}</span></li>
          <li className="caption">uptime <span className="mono-id">{s ? `${Math.floor(s.uptime_seconds)}s` : "unknown"}</span></li>
          <li className="caption">version <span className="mono-id">{s?.version ?? "unknown"}</span></li>
        </ul>
      </Widget>

      <Widget title="Queue">
        {q ? (
          <>
            <p className="metric">
              {q.running}/{q.workers} running · {q.queued}/{q.capacity} queued
            </p>
            <div className="dash-cells" aria-label="worker slots">
              {Array.from({ length: q.workers }, (_, i) => (
                <span key={`w${i}`} className={`dash-cell worker${i < q.running ? " on" : ""}`} />
              ))}
            </div>
            <div className="dash-cells" aria-label="queue slots">
              {Array.from({ length: q.capacity }, (_, i) => (
                <span key={`q${i}`} className={`dash-cell${i < q.queued ? " on" : ""}`} />
              ))}
            </div>
          </>
        ) : (
          <p className="caption">unknown</p>
        )}
      </Widget>

      <Widget title="In flight">
        {live.length === 0 ? <p className="caption">No scans in flight.</p> : null}
        {live.map((scan) => {
          const secs = elapsedSeconds(scan.created_at, now);
          return (
            <Link key={scan.id} href={`/scans/${scan.id}`} className="proc-card">
              <span className="mono-id">{scan.id.slice(0, 12)}</span>
              <span className="caption">
                {scan.source} · {scan.stage || scan.status} · <span className="mono-id">{scan.progress}%</span> ·{" "}
                <span className="mono-id">{secs == null ? "unknown" : `${secs}s`}</span>
              </span>
              <span className="bar-track">
                <span className="bar-fill" style={{ width: `${scan.progress}%` }} />
              </span>
              {scan.message ? <span className="caption">{scan.message}</span> : null}
            </Link>
          );
        })}
      </Widget>

      <Widget title="Risk snapshot">
        {risks.length === 0 ? <p className="caption">No finished scans.</p> : null}
        <div className="bars">
          {risks.map((row) => (
            <div key={row.id} className="bar-row">
              <span className="mono-id">{row.id}</span>
              <span className="bar-track">
                {row.risk != null ? <span className="bar-fill" style={{ width: `${row.risk}%` }} /> : null}
              </span>
              <span className="mono-id">{metricLabel(row.risk)}</span>
            </div>
          ))}
        </div>
      </Widget>

      <Widget title="Quick actions">
        <div className="actions">
          <Button disabled={busy !== ""} onClick={() => queue("demo", { source: "demo" })}>
            {busy === "demo" ? "Queuing…" : "Queue demo scan"}
          </Button>
          <Link href="#scan" className="pill secondary">
            New scan
          </Link>
        </div>
        {error ? <p className="error">{error}</p> : null}
      </Widget>

      <Widget title="API usage">
        {!s ? <p className="caption">unknown</p> : null}
        <div className="bars">
          {usage.map((e) => (
            <div key={`${e.method} ${e.path}`} className="bar-row proc-usage">
              <span className="mono-id">
                {e.method} {e.path}
              </span>
              <span className="bar-track">
                <span className="bar-fill" style={{ width: `${(e.usage.count / maxCount) * 100}%` }} />
              </span>
              <span className="mono-id">
                {e.usage.count} · {e.usage.errors} err · {e.usage.avg_ms}ms
              </span>
            </div>
          ))}
        </div>
        {s ? (
          <button type="button" className="pill secondary" onClick={() => setShowUnused((v) => !v)}>
            {showUnused ? "Hide unused" : "Show unused"}
          </button>
        ) : null}
        <p className="caption">In-memory since core start.</p>
      </Widget>

      <Widget title="Scans" wide>
        <div className="actions" role="tablist" aria-label="Status filter">
          {SCAN_STATUSES.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              className="tab"
              aria-selected={filter === value}
              onClick={() => setFilter(value)}
            >
              {value}
            </button>
          ))}
          <input
            className="dash-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search id, source, or repository"
            aria-label="Search scans"
          />
        </div>
        {scansFailed ? <p className="error">Scan list unavailable.</p> : null}
        {rows.length === 0 && !scansFailed ? <p className="caption">No scans match.</p> : null}
        <div className="table-wrap">
          {rows.map((scan) => {
            const rerun = rerunPayload(scan);
            return (
              <div key={scan.id} className="table-row dash-row">
                <span className="mono-id">{scan.id}</span>
                <span className="caption">{scan.source}</span>
                <span className="caption">{scan.status}</span>
                <span className="mono-id">risk {metricLabel(scan.summary?.risk)}</span>
                <span className="mono-id">{metricLabel(scan.summary?.findings)} findings</span>
                <span className="caption">{relativeTime(scan.updated_at, now)}</span>
                <span className="actions">
                  <Link href={`/scans/${scan.id}`} className="pill secondary">
                    Open
                  </Link>
                  {rerun ? (
                    <Button tone="secondary" disabled={busy !== ""} onClick={() => queue(scan.id, rerun)}>
                      {busy === scan.id ? "Queuing…" : "Re-run"}
                    </Button>
                  ) : (
                    <span className="caption">re-run needs the lockfile</span>
                  )}
                  <Button tone="secondary" onClick={() => navigator.clipboard.writeText(scan.id)}>
                    Copy ID
                  </Button>
                </span>
                {scan.status === "failed" && scan.error ? <span className="caption dash-error">{scan.error}</span> : null}
              </div>
            );
          })}
        </div>
      </Widget>
    </div>
  );
}

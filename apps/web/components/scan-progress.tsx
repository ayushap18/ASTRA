"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ScanEvent } from "@/lib/types";

// Each stage owns a block colour, so the strip fills with colour as the scan
// advances instead of dimming uniform grey text.
const STAGES = [
  { key: "repository_ingestion", label: "Ingest", tone: "cream" },
  { key: "ecosystem_detection", label: "Manifest", tone: "cream" },
  { key: "dependency_resolution", label: "Resolve", tone: "mint" },
  { key: "metadata_enrichment", label: "Registry", tone: "mint" },
  { key: "vulnerability_matching", label: "OSV", tone: "coral" },
  { key: "reachability_analysis", label: "Reach", tone: "lilac" },
  { key: "risk_aggregation", label: "Risk", tone: "pink" },
  { key: "completed", label: "Ready", tone: "lime" },
] as const;

function terminal(type: string) {
  return type === "SCAN_COMPLETED" || type === "SCAN_FAILED";
}

export function ScanProgress({ scanId, initial }: { scanId: string; initial: ScanEvent[] }) {
  const router = useRouter();
  const [events, setEvents] = useState(initial);
  const latest = events[events.length - 1];
  const failed = latest?.type === "SCAN_FAILED";
  const active = STAGES.findIndex((stage) => stage.key === latest?.stage);
  const index = failed ? -1 : latest?.progress === 100 ? STAGES.length - 1 : active;

  useEffect(() => {
    if (terminal(initial.at(-1)?.type ?? "")) {
      return;
    }
    const lastSeen = { id: initial.at(-1)?.id ?? 0 };
    const controller = new AbortController();
    let buffer = "";

    async function read() {
      const response = await fetch(`/api/v1/scans/${scanId}/events`, {
        headers: lastSeen.id ? { "Last-Event-ID": String(lastSeen.id) } : undefined,
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok || !response.body) return false;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let finished = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const dataLine = chunk.split("\n").find((line) => line.startsWith("data:"));
          if (!dataLine) continue;
          const payload = JSON.parse(dataLine.slice(5).trim()) as ScanEvent;
          lastSeen.id = payload.id;
          setEvents((current) => (current.some((item) => item.id === payload.id) ? current : [...current, payload]));
          if (terminal(payload.type)) {
            finished = true;
            router.refresh();
          }
        }
      }
      return finished;
    }

    (async () => {
      while (!controller.signal.aborted) {
        try {
          if (await read()) return;
        } catch {
          if (controller.signal.aborted) return;
        }
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    })();
    return () => controller.abort();
  }, [scanId, initial, router]);

  if (!latest) return null;
  const width = failed ? 8 : Math.max(4, latest.progress);
  return (
    <div className={`process${failed ? " failed" : ""}`} aria-live="polite">
      <div className="process-head">
        <p className="process-count">{failed ? "—" : `${latest.progress}%`}</p>
        <div className="process-meta">
          <p className="eyebrow">{failed ? "Scan failed" : latest.stage.replace(/_/g, " ")}</p>
          <p className="body-sm">{latest.message}</p>
        </div>
      </div>
      <div className="process-rail">
        <span className="process-fill" style={{ width: `${width}%` }} />
      </div>
      <ol className="process-steps">
        {STAGES.map((stage, step) => {
          // At 100% every stage is finished; nothing should still read as in-flight.
          const done = latest.progress === 100 ? step <= index : step < index;
          const state = failed ? "pending" : done ? "done" : step === index ? "active" : "pending";
          return (
            <li key={stage.key} className={`step-${state} tone-${stage.tone}`}>
              <span className="step-dot" aria-hidden="true" />
              {stage.label}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

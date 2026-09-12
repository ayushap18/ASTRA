"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ScanSummary } from "@/lib/dashboard";
import { api, type Graph, type GraphPackage, type Scan } from "@/lib/types";
import { confirmRemediation, dispatchVoiceCommand, type VoiceDispatchResult } from "@/lib/voice/dispatch";
import { localPlan, needsSarvamPlan, runPlan, validatePlan, type VoicePlan } from "@/lib/voice/plan";

type Reply = {
  text: string;
  provider?: string;
  ai_generated?: boolean;
  evidence_ids?: string[];
  warnings?: string[];
};
type State = "idle" | "listening" | "checking";
const GLYPH = { pending: "○", running: "◐", done: "●", failed: "✕", skipped: "–" } as const;

export function VoiceControl({ scans }: { scans: ScanSummary[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState("");
  const [transcript, setTranscript] = useState("");
  const [language, setLanguage] = useState("en-IN");
  const [reply, setReply] = useState<Reply | null>(null);
  const [result, setResult] = useState<VoiceDispatchResult | null>(null);
  const [plan, setPlan] = useState<VoicePlan | null>(null);
  const [graph, setGraph] = useState<{ scanId: string; packages: GraphPackage[] } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  const scanId = pathname.match(/\/scans\/([^/]+)/)?.[1];
  const scan = scans.find((s) => s.id === scanId);
  const ready = scan?.status === "completed" || scan?.status === "partial";

  useEffect(() => {
    if (!scanId || !ready || graph?.scanId === scanId) return;
    api<Graph>(`/api/v1/scans/${scanId}/graph`)
      .then((g) => setGraph({ scanId, packages: g.packages }))
      .catch(() => {});
  }, [scanId, ready, graph]);

  const deps = {
    api,
    navigate: (href: string) => router.push(href),
    handoffVerify: () => window.dispatchEvent(new Event("astra-voice-verify")),
    scanId,
  };

  async function speak(text: string) {
    if (!text) return;
    const res = await fetch("/api/voice/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, language }),
    }).catch(() => null);
    if (!res?.ok) {
      const body = await res?.json().catch(() => ({}));
      setError(`Speech unavailable: ${body?.error?.code ?? "tts_failed"}`);
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    audio.play().catch(() => {});
  }

  async function buildCard() {
    // The shell's scan list polls every 2.5s; if the user talks before it lands, fetch the scan directly.
    const scan =
      scans.find((s) => s.id === scanId) ??
      (scanId
        ? await api<Scan>(`/api/v1/scans/${scanId}`)
            .then((s) => ({ ...s, summary: s.analysis?.summary }))
            .catch(() => undefined)
        : undefined);
    const params = new URLSearchParams(window.location.search);
    const pkg = graph?.packages.find((p) => p.id === params.get("package"));
    const card = {
      scan_id: scan?.id,
      status: scan?.status,
      source: scan?.source,
      repository: scan?.repository,
      summary: scan?.summary && {
        risk: scan.summary.risk,
        trust: scan.summary.trust,
        confidence: scan.summary.confidence,
        packages: scan.summary.packages,
        findings: scan.summary.findings,
      },
      package: pkg && { id: pkg.id, name: pkg.name, version: pkg.version, depth: pkg.depth },
    };
  }

  async function ask(utterance: string) {
    const answer = await api<Reply>("/api/voice/ask", {
      method: "POST",
      body: JSON.stringify({ card: await buildCard(), utterance, language }),
    });
    setReply(answer);
    await speak(answer.text);
  }

  async function handle(blob: Blob) {
    setState("checking");
    setError("");
    setReply(null);
    setResult(null);
    setPlan(null);
    try {
      const res = await fetch("/api/voice/stt", {
        method: "POST",
        headers: { "Content-Type": blob.type || "application/octet-stream" },
        body: blob,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error?.message ?? `STT failed (${res.status})`);
      const text: string = body.transcript ?? "";
      const lang: string = body.language || "en-IN";
      setTranscript(text);
      setLanguage(lang);
      const packages = graph && graph.scanId === scanId ? graph.packages : [];
      const ctx = { pathname, scanId, scanStatus: scan?.status, packages, scans };
      let next = localPlan(text, ctx);
      if (needsSarvamPlan(next, text)) {
        const proposed = validatePlan(
          await api<unknown>("/api/voice/plan", {
            method: "POST",
            body: JSON.stringify({
              card: await buildCard(),
              utterance: text,
              packages: packages.map((p) => `${p.name}@${p.version}`),
              language,
            }),
          }).catch(() => null),
          ctx,
        );
        if (proposed.steps.length) next = proposed;
      }
      const only = next.steps.length === 1 ? next.steps[0].command : null;
      // A lone remediate keeps today's Confirm pill; every other confirmable or multi-step plan shows Run.
      if (only && (!next.needsConfirm || only.type === "remediate")) {
        const out = await dispatchVoiceCommand(only, deps);
        if (out.ask) {
          await ask(text);
        } else {
          setResult(out);
          setReply({ text: out.speak, provider: "deterministic", ai_generated: false });
          await speak(out.speak);
        }
      } else {
        setPlan(next);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Voice failed");
    } finally {
      setState("idle");
    }
  }

  async function start() {
    if (recorder.current) return;
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = "audio/webm;codecs=opus";
      const rec = new MediaRecorder(
        stream,
        MediaRecorder.isTypeSupported(mime) ? { mimeType: mime } : undefined,
      );
      chunks.current = [];
      rec.ondataavailable = (e) => chunks.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        recorder.current = null;
        handle(new Blob(chunks.current, { type: rec.mimeType }));
      };
      rec.start();
      recorder.current = rec;
      setState("listening");
    } catch {
      setError("Microphone permission denied.");
      setState("idle");
    }
  }

  function stop() {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  async function confirm() {
    const n = result?.pendingRemediation;
    if (!n) return;
    setResult(null);
    const out = await confirmRemediation(n, deps);
    setResult(out);
    setReply({ text: out.speak, provider: "deterministic", ai_generated: false });
    await speak(out.speak);
  }

  async function run() {
    if (!plan) return;
    setState("checking");
    const summary = await runPlan(plan, { ...deps, say: (t) => void speak(t) }, setPlan);
    setReply({ text: summary, provider: "deterministic", ai_generated: false });
    setState("idle");
    await speak(summary);
  }

  const label = state === "listening" ? "listening" : state === "checking" ? "Checking…" : "idle";
  const showPanel = transcript || reply || error || plan;

  return (
    <div className="voice-control">
      <Button
        tone="magenta"
        size="sm"
        className={state === "listening" ? "voice-pulse" : ""}
        aria-pressed={state === "listening"}
        aria-label="Hold to talk to Sarvam"
        disabled={state === "checking"}
        onPointerDown={start}
        onPointerUp={stop}
        onPointerCancel={stop}
        onPointerLeave={stop}
        onKeyDown={(e) => {
          if (e.key === " " && !e.repeat) {
            e.preventDefault();
            start();
          }
        }}
        onKeyUp={(e) => e.key === " " && stop()}
      >
        Talk
      </Button>
      <span className="caption">{label}</span>
      {result?.pendingRemediation ? (
        <Button tone="secondary" size="sm" onClick={confirm}>
          Confirm {result.pendingRemediation} changes
        </Button>
      ) : null}
      {showPanel ? (
        <div className={`voice-panel${reply?.ai_generated ? " ai" : ""}`} aria-live="polite">
          {transcript ? <p className="caption">heard: {transcript}</p> : null}
          {error ? <p className="error">{error}</p> : null}
          {plan ? (
            <div className="plan-list">
              <ol>
                {plan.steps.map((s, i) => (
                  <li key={i} className={`plan-step ${s.status}`}>
                    <span className="plan-glyph" aria-label={s.status}>
                      {GLYPH[s.status]}
                    </span>{" "}
                    {s.label}
                    {s.detail ? <span className="caption"> — {s.detail}</span> : null}
                  </li>
                ))}
              </ol>
              <p className={`caption${plan.source === "sarvam" ? " plan-sarvam" : ""}`}>
                planned by: {plan.source === "sarvam" ? "Sarvam" : "local"}
              </p>
              {plan.steps.some((s) => s.status === "pending") && state === "idle" ? (
                <div className="plan-actions">
                  <Button onClick={run}>Run</Button>
                  <Button tone="secondary" onClick={() => setPlan(null)}>
                    Cancel
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
          {reply?.text ? <p className="body-lg">{reply.text}</p> : null}
          {reply ? (
            <p className="caption">
              {reply.provider ?? "unknown"} · ai_generated {String(reply.ai_generated ?? false)}
            </p>
          ) : null}
          {reply?.evidence_ids?.length ? (
            <p className="mono-id">evidence {reply.evidence_ids.join(" ")}</p>
          ) : null}
          {reply?.warnings?.map((w) => (
            <p key={w} className="caption">
              {w}
            </p>
          ))}
          {result?.detail ? <p className="caption">{result.detail}</p> : null}
          {result?.candidates?.map((c) => (
            <p key={c.id} className="mono-id">
              {c.id} · {c.name}@{c.version}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

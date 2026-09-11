"use client";

import { FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { remediationPayload } from "@/lib/payloads";
import { api, type Remediation } from "@/lib/types";

export function RemediateForm({ scanId, ready, demo }: { scanId: string; ready: boolean; demo: boolean }) {
  const [maxChanges, setMaxChanges] = useState(3);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [plan, setPlan] = useState<Remediation | null>(null);
  const [zipName, setZipName] = useState("");

  useEffect(() => {
    const focusZip = () => document.getElementById("verify-zip")?.focus();
    window.addEventListener("astra-voice-verify", focusZip);
    return () => window.removeEventListener("astra-voice-verify", focusZip);
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const result = await api<Remediation>(`/api/v1/scans/${scanId}/remediation`, {
        method: "POST",
        body: JSON.stringify(remediationPayload(maxChanges)),
      });
      setPlan(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remediation failed");
    } finally {
      setPending(false);
    }
  }

  async function onVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setVerifying(true);
    const data = new FormData(event.currentTarget);
    data.set("max_changes", String(maxChanges));
    try {
      const response = await fetch(`/api/v1/scans/${scanId}/verify`, { method: "POST", body: data });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
      }
      setPlan(body as Remediation);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setVerifying(false);
    }
  }

  if (!ready) {
    return <p className="body-lg">Wait for a completed or partial scan before requesting a proposal.</p>;
  }

  return (
    <>
      <form className="stack" onSubmit={onSubmit}>
        <label className="field">
          <span className="caption">Maximum changes</span>
          <input
            type="number"
            min={1}
            max={100}
            value={maxChanges}
            onChange={(event) => setMaxChanges(Number(event.target.value))}
            required
          />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <Button type="submit" disabled={pending}>
          {pending ? "Planning…" : "Request proposal"}
        </Button>
      </form>
      {plan ? (
        <section className="stack">
          <p className="eyebrow">
            {plan.status} · verified {String(plan.verified)}
          </p>
          <p className="body-lg">
            Current risk {plan.current_risk}. Predicted risk is {plan.predicted_risk ?? "null"} (re-analyzed lockfile bump).{" "}
            {plan.verified
              ? "verified:true means npm ci --ignore-scripts and declared test/build passed in an isolated container. It is not a safety claim."
              : "verified stays false until that isolated check passes. Do not treat this as a verified-safe patch."}{" "}
            {plan.potentially_addressed_findings} of {plan.total_findings} findings are candidates.
          </p>
          {plan.changes.map((change) => (
            <article key={`${change.package_id}:${change.to}`} className="finding">
              <p className="caption">
                {change.action} · {change.major_change ? "major" : "non-major"} · verified {String(change.verified)}
              </p>
              <p className="body-lg">
                {change.package} {change.from} → {change.to}
              </p>
              <p className="caption">findings {change.finding_ids.join(" ")}</p>
            </article>
          ))}
          <p className="caption">remaining {plan.remaining_finding_ids.join(" ") || "none"}</p>
          {plan.verification_required.map((line) => (
            <p key={line} className="caption">
              {line}
            </p>
          ))}
          {plan.limitations.map((line) => (
            <p key={line} className="caption">
              {line}
            </p>
          ))}
        </section>
      ) : null}
      {plan && !demo ? (
        <form className="stack" onSubmit={onVerify}>
          <label className="field">
            <span className="caption">Project ZIP matching this scan’s lockfile</span>
            <input
              id="verify-zip"
              type="file"
              name="project"
              accept=".zip,application/zip"
              required
              onChange={(event) => setZipName(event.target.files?.[0]?.name ?? "")}
            />
          </label>
          <p className="caption">
            Used once, never stored. Must declare test and/or build. {zipName || "No file selected."}
          </p>
          <Button type="submit" disabled={verifying}>
            {verifying ? "Verifying…" : "Run isolated test/build"}
          </Button>
        </form>
      ) : null}
      {demo ? <p className="caption">Demo fixture packages are synthetic and cannot be build-verified.</p> : null}
    </>
  );
}

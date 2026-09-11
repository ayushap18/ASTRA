"use client";

import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { CREDENTIAL_CATEGORIES, simulatePayload, type CredentialCategory } from "@/lib/payloads";
import { api, type GraphPackage, type Simulation } from "@/lib/types";

export function AttackForm({
  scanId,
  ready,
  packages,
  initialPackageId,
}: {
  scanId: string;
  ready: boolean;
  packages: GraphPackage[];
  initialPackageId?: string;
}) {
  const [packageId, setPackageId] = useState(initialPackageId || packages[0]?.id || "");
  const [ciInstall, setCiInstall] = useState(false);
  const [lifecycleScripts, setLifecycleScripts] = useState(false);
  const [categories, setCategories] = useState<CredentialCategory[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Simulation | null>(null);

  function toggle(category: CredentialCategory) {
    setCategories((current) =>
      current.includes(category) ? current.filter((item) => item !== category) : [...current, category],
    );
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const simulation = await api<Simulation>(`/api/v1/scans/${scanId}/simulate`, {
        method: "POST",
        body: JSON.stringify(simulatePayload({ packageId, ciInstall, lifecycleScripts, categories })),
      });
      setResult(simulation);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Simulation failed");
    } finally {
      setPending(false);
    }
  }

  if (!ready) {
    return <p className="body-lg">Wait for a completed or partial scan before simulating.</p>;
  }
  if (!packages.length) {
    return <p className="body-lg">Graph is not available yet.</p>;
  }

  return (
    <>
      <form className="stack" onSubmit={onSubmit}>
        <label className="field">
          <span className="caption">Package instance</span>
          <select value={packageId} onChange={(event) => setPackageId(event.target.value)} required>
            {packages.map((pkg) => (
              <option key={pkg.id} value={pkg.id}>
                {pkg.name}@{pkg.version} · depth {pkg.depth} · {pkg.direct ? "direct" : "transitive"}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={ciInstall} onChange={(event) => setCiInstall(event.target.checked)} />
          CI install
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={lifecycleScripts}
            onChange={(event) => setLifecycleScripts(event.target.checked)}
          />
          Lifecycle scripts enabled
        </label>
        <div className="stack">
          <span className="caption">Credential categories</span>
          {CREDENTIAL_CATEGORIES.map((category) => (
            <label key={category} className="check">
              <input
                type="checkbox"
                checked={categories.includes(category)}
                onChange={() => toggle(category)}
              />
              {category}
            </label>
          ))}
        </div>
        {error ? <p className="error">{error}</p> : null}
        <Button type="submit" disabled={pending}>
          {pending ? "Simulating…" : "Simulate compromise"}
        </Button>
      </form>
      {result ? (
        <section className="stack">
          <p className="eyebrow">Experimental ATR</p>
          <p className="display">{result.toxicity_radius}</p>
          <p className="body-lg">
            Ancestry is not execution. {result.path_semantics}. Model {result.model_version}.
          </p>
          <p className="caption">evidence {result.evidence_ids.join(" ")}</p>
          {result.limitations.map((line) => (
            <p key={line} className="caption">
              {line}
            </p>
          ))}
          {result.propagation.length ? (
            <div>
              {result.propagation.map((edge) => (
                <p key={`${edge.source}->${edge.target}`} className="caption">
                  {edge.source} → {edge.target}
                </p>
              ))}
            </div>
          ) : (
            <p className="body-lg">No CI credential propagation under these assumptions.</p>
          )}
        </section>
      ) : null}
    </>
  );
}

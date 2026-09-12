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
        <section className="stack atr">
          <p className="eyebrow">Experimental ATR</p>
          <div className="atr-head">
            <p className="display">{result.toxicity_radius}</p>
            <span className="bar-track" aria-hidden="true">
              <span className="bar-fill" style={{ width: `${result.toxicity_radius}%` }} />
            </span>
          </div>
          <p className="body-lg">
            {result.affected_packages.length} of {result.installed_packages} installed packages are downstream of{" "}
            {result.origin}
            {result.assumptions.observed_install_script ? ", which ships an install script" : ""}.
          </p>
          <div className="bars">
            {Object.entries(result.factors).map(([name, value]) => (
              <div key={name} className="bar-row">
                <span className="caption">{name.replace(/_/g, " ")}</span>
                <span className="bar-track" aria-hidden="true">
                  <span className="bar-fill" style={{ width: `${Math.min(100, value * 50)}%` }} />
                </span>
                <span className="mono-id">{value.toFixed(2)}</span>
              </div>
            ))}
          </div>
          <dl className="exposure">
            {Object.entries(result.secret_exposure_potential).map(([category, level]) => (
              <div key={category}>
                <dt className="caption">{category.replace(/_/g, " ")}</dt>
                <dd className={`mono-id level-${level}`}>{level}</dd>
              </div>
            ))}
          </dl>
          {result.propagation.length ? (
            <div className="scroll-list">
              {result.propagation.map((edge) => (
                <p key={`${edge.source}->${edge.target}`} className="mono-id">
                  {edge.source} → {edge.target}
                </p>
              ))}
            </div>
          ) : (
            <p className="body">No CI credential propagation under these assumptions.</p>
          )}
          <div className="stack-sm">
            {result.limitations.map((line) => (
              <p key={line} className="caption">
                {line}
              </p>
            ))}
            <p className="caption">
              {result.path_semantics}. Model {result.model_version}. Evidence {result.evidence_ids.join(" ")}
            </p>
          </div>
        </section>
      ) : null}
    </>
  );
}

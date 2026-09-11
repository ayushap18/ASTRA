"use client";

import { unzipSync } from "fflate";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { api, type ScanCreated } from "@/lib/types";
import { filesFromZip } from "@/lib/zip-ingest";

type Source = "demo" | "github" | "lockfile" | "zip";

export function ScanForm() {
  const router = useRouter();
  const [source, setSource] = useState<Source>("demo");
  const [repository, setRepository] = useState("");
  const [token, setToken] = useState("");
  const [manifest, setManifest] = useState("");
  const [lockfile, setLockfile] = useState("");
  const [zip, setZip] = useState<File | null>(null);
  const [denied, setDenied] = useState("GPL-3.0-only");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setPending(true);
    const denied_licenses = denied
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    try {
      let payload: Record<string, unknown> = { source: source === "zip" ? "lockfile" : source, denied_licenses };
      if (source === "github") {
        payload = { ...payload, repository };
        if (token) payload.github_token = token;
      }
      if (source === "lockfile") {
        payload = { ...payload, manifest: JSON.parse(manifest), lockfile: JSON.parse(lockfile) };
      }
      if (source === "zip") {
        if (!zip) throw new Error("Choose a project ZIP");
        const raw = new Uint8Array(await zip.arrayBuffer());
        const extracted = filesFromZip(unzipSync(raw));
        payload = { ...extracted, denied_licenses };
      }
      const created = await api<ScanCreated>("/api/v1/scans", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setToken("");
      router.push(`/scans/${created.scan_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan could not be created");
      setPending(false);
    }
  }

  return (
    <form className="stack" onSubmit={onSubmit} autoComplete="off">
      <div className="tabs" role="tablist" aria-label="Scan source">
        {(["demo", "github", "zip", "lockfile"] as const).map((value) => (
          <button
            key={value}
            type="button"
            className="tab"
            role="tab"
            aria-selected={source === value}
            onClick={() => setSource(value)}
          >
            {value}
          </button>
        ))}
      </div>
      {source === "github" ? (
        <>
          <label className="field">
            <span className="caption">GitHub HTTPS URL</span>
            <input
              value={repository}
              onChange={(e) => setRepository(e.target.value)}
              placeholder="https://github.com/org/repo"
              required
            />
          </label>
          <label className="field">
            <span className="caption">Fine-grained or classic PAT (optional, never stored)</span>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ghp_ or github_pat_"
              autoComplete="off"
            />
          </label>
        </>
      ) : null}
      {source === "zip" ? (
        <label className="field">
          <span className="caption">Project ZIP with package.json and package-lock.json</span>
          <input type="file" accept=".zip,application/zip" onChange={(e) => setZip(e.target.files?.[0] ?? null)} required />
        </label>
      ) : null}
      {source === "lockfile" ? (
        <>
          <label className="field">
            <span className="caption">package.json</span>
            <textarea value={manifest} onChange={(e) => setManifest(e.target.value)} required />
          </label>
          <label className="field">
            <span className="caption">package-lock.json</span>
            <textarea value={lockfile} onChange={(e) => setLockfile(e.target.value)} required />
          </label>
        </>
      ) : null}
      <label className="field">
        <span className="caption">Denied licenses</span>
        <input value={denied} onChange={(e) => setDenied(e.target.value)} />
      </label>
      {error ? <p className="error">{error}</p> : null}
      <div className="actions">
        <Button type="submit" disabled={pending}>
          {pending ? "Queuing…" : "Start scan"}
        </Button>
        {source !== "demo" ? (
          <Button type="button" tone="secondary" onClick={() => setSource("demo")}>
            Use demo fixture
          </Button>
        ) : null}
      </div>
    </form>
  );
}

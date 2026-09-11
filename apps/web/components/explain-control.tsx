"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api, type Explanation } from "@/lib/types";

// Codes must match intelligence ExplainRequest.language (Odia is "or").
const LANGUAGES: [string, string][] = [
  ["en", "English"],
  ["hi", "Hindi"],
  ["bn", "Bengali"],
  ["ta", "Tamil"],
  ["te", "Telugu"],
  ["mr", "Marathi"],
  ["gu", "Gujarati"],
  ["kn", "Kannada"],
  ["ml", "Malayalam"],
  ["pa", "Punjabi"],
  ["or", "Odia"],
];

export function ExplainControl({ scanId, packageId }: { scanId: string; packageId: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Explanation | null>(null);
  const [language, setLanguage] = useState("en");

  async function run(useAi: boolean) {
    setError("");
    setPending(true);
    try {
      const explanation = await api<Explanation>(`/api/v1/scans/${scanId}/explain`, {
        method: "POST",
        body: JSON.stringify({ package_id: packageId, language, use_ai: useAi }),
      });
      setResult(explanation);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Explain failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="stack">
      <label className="field">
        <span className="caption">Language</span>
        <select value={language} onChange={(event) => setLanguage(event.target.value)}>
          {LANGUAGES.map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="actions">
        <Button tone="secondary" disabled={pending} onClick={() => run(false)}>
          Explain
        </Button>
        <Button tone="magenta" disabled={pending} onClick={() => run(true)}>
          Explain with AI
        </Button>
      </div>
      <p className="caption">
        Explain is deterministic English; a non-English choice without AI returns the English text with a translation
        warning. Explain with AI sends only the allowlisted payload to Sarvam.
      </p>
      {error ? <p className="error">{error}</p> : null}
      {result ? (
        <div className="stack">
          <p className="caption">
            {result.provider} · {result.language} · ai_generated {String(result.ai_generated)}
          </p>
          <p className="body-lg">{result.text}</p>
          {result.warnings.map((line) => (
            <p key={line} className="caption">
              {line}
            </p>
          ))}
          <p className="caption">evidence {result.evidence_ids.join(" ")}</p>
        </div>
      ) : null}
    </div>
  );
}

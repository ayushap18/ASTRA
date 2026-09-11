"use client";

import { Button } from "@/components/ui/button";

export default function ScanError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="stack">
      <section className="panel accent-navy stack">
        <p className="eyebrow">Error</p>
        <h1 className="headline">{error.message || "Scan could not be loaded"}</h1>
        <Button tone="secondary" onClick={reset}>
          Try again
        </Button>
      </section>
    </main>
  );
}

"use client";

import { Button } from "@/components/ui/button";

export default function ErrorView({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="workspace stack">
      <section className="panel accent-navy stack">
        <p className="eyebrow">Error</p>
        <h1 className="headline">{error.message || "Request could not be completed"}</h1>
        <Button tone="primary" onClick={reset}>
          Try again
        </Button>
      </section>
    </main>
  );
}

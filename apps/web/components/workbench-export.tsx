"use client";

import { Button } from "@/components/ui/button";
import { workbenchExport } from "@/lib/investigation";
import type { Finding, Graph, Scan } from "@/lib/types";

export function WorkbenchExport({
  scan,
  findings,
  graph,
}: {
  scan: Scan;
  findings: Finding[];
  graph: Graph | null;
}) {
  function download() {
    const report = workbenchExport({
      scan,
      findings,
      graph,
      exportedAt: new Date().toISOString(),
    });
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `astra-${scan.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Button tone="secondary" onClick={download}>
      Export workbench JSON
    </Button>
  );
}

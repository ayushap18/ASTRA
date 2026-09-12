"use client";

import Link from "next/link";
import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { EvidenceStrip } from "@/components/evidence-strip";
import { ExplainControl } from "@/components/explain-control";
import { investigationHref, parseInvestigationSearch } from "@/lib/investigation";
import { selectFinding } from "@/lib/dashboard";
import type { Evidence, Finding } from "@/lib/types";

export function FindingList({
  scanId,
  findings,
  evidence,
}: {
  scanId: string;
  findings: Finding[];
  evidence: Evidence[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = parseInvestigationSearch(searchParams);
  const selected = selectFinding(findings, query);
  const selectedId = selected?.id ?? "";
  const records = useMemo(() => {
    if (!selected) return [];
    const ids = new Set(selected.evidence_ids);
    return evidence.filter((item) => ids.has(item.id));
  }, [evidence, selected]);

  if (!findings.length) return null;

  function focus(finding: Finding) {
    router.replace(
      investigationHref(pathname, { finding: finding.id, package: finding.package_id }),
      { scroll: false },
    );
  }

  return (
    <div className="stack">
      <div className="scroll-list">
        {findings.map((finding) => (
          <button
            key={finding.id}
            type="button"
            className={`finding finding-button sev-${finding.severity}${finding.id === selectedId ? " selected" : ""}`}
            aria-current={finding.id === selectedId ? "true" : undefined}
            onClick={() => focus(finding)}
          >
            <p className="caption">
              {finding.kind} · {finding.severity}
            </p>
            <p className="body-lg">{finding.title}</p>
            <p className="caption">evidence {finding.evidence_ids.join(" ")}</p>
          </button>
        ))}
      </div>
      {selected ? (
        <>
          <EvidenceStrip records={records} />
          <div className="actions">
            <Link
              className="pill secondary"
              href={investigationHref(`/scans/${scanId}/graph`, {
                package: selected.package_id,
                finding: selected.id,
              })}
            >
              Open on graph
            </Link>
            <Link
              className="pill secondary"
              href={investigationHref(`/scans/${scanId}/attack`, {
                package: selected.package_id,
                finding: selected.id,
              })}
            >
              Simulate this instance
            </Link>
          </div>
          <ExplainControl scanId={scanId} packageId={selected.package_id} />
        </>
      ) : null}
    </div>
  );
}

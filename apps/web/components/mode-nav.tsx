"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { withInvestigationSearch } from "@/lib/investigation";

const MODES = [
  { suffix: "", label: "Overview" },
  { suffix: "/graph", label: "Graph" },
  { suffix: "/attack", label: "Attack" },
  { suffix: "/timeline", label: "Timeline" },
  { suffix: "/remediate", label: "Remediate" },
] as const;

export function ModeNav({ scanId }: { scanId: string }) {
  const path = usePathname();
  const search = useSearchParams();
  const query = parseCaption(search);
  return (
    <div className="stack-sm">
      <nav className="mode-nav" aria-label="Investigation">
        {MODES.map((mode) => {
          const pathname = `/scans/${scanId}${mode.suffix}`;
          const href = withInvestigationSearch(pathname, search);
          const current =
            mode.suffix === "" ? path === pathname : path === pathname || path.startsWith(`${pathname}/`);
          return (
            <Link key={mode.label} href={href} aria-current={current ? "page" : undefined}>
              {mode.label}
            </Link>
          );
        })}
      </nav>
      {query ? (
        <p className="caption">
          Workbench focus · {query}
        </p>
      ) : null}
    </div>
  );
}

function parseCaption(search: URLSearchParams) {
  const finding = search.get("finding");
  const pkg = search.get("package");
  if (finding && pkg) return `finding ${finding} · instance ${pkg}`;
  if (finding) return `finding ${finding}`;
  if (pkg) return `instance ${pkg}`;
  return "";
}

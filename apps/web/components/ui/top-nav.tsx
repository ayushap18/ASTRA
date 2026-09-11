"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export function TopNav() {
  const path = usePathname();
  const home = path === "/";
  const [ready, setReady] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/ready")
      .then((response) => setReady(response.ok))
      .catch(() => setReady(false));
  }, []);

  const statusLabel = ready === null ? "Checking" : ready ? "Ready" : "Degraded";
  const statusState = ready === null ? "checking" : ready ? "ready" : "degraded";

  return (
    <header className="shell top-nav">
      <Link href="/" className="brand-mark" aria-label="Astra Home">
        Astra
      </Link>
      <div className="nav-end">
        <div className="status-badge" title={`Core status: ${statusLabel}`}>
          <span className={`status-dot ${statusState}`} />
          <span className="caption">{statusLabel}</span>
        </div>
        <Link href="/" className="pill tertiary" aria-current={home ? "page" : undefined}>
          Home
        </Link>
        {home ? (
          <Link href="#scan" className="pill tertiary">
            Start scan
          </Link>
        ) : (
          <Link href="/" className="pill primary">
            New scan
          </Link>
        )}
      </div>
    </header>
  );
}


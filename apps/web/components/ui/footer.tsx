import Link from "next/link";

export function Footer() {
  return (
    <footer className="footer">
      <div className="shell footer-grid">
        <div className="footer-col">
          <span className="brand-mark">Astra</span>
          <p className="caption">
            Autonomous Software Trust &amp; Risk Analyzer
          </p>
          <p className="body-sm" style={{ marginTop: "8px", maxWidth: "320px" }}>
            Software supply-chain investigation built on a dependency digital twin, compromise simulation, and candidate remediation.
          </p>
        </div>

        <div className="footer-col">
          <span className="caption">Architecture</span>
          <ul className="footer-links">
            <li><span>Dependency Digital Twin</span></li>
            <li><span>OSV Exact Version Matching</span></li>
            <li><span>Compromise Simulator</span></li>
            <li><span>Candidate Remediation</span></li>
          </ul>
        </div>

        <div className="footer-col">
          <span className="caption">Principles</span>
          <ul className="footer-links">
            <li><span>Unknown Stays Unknown</span></li>
            <li><span>Proposals Unverified</span></li>
            <li><span>Ancestry ≠ Execution</span></li>
            <li><span>No Dynamic Script Exec</span></li>
          </ul>
        </div>

        <div className="footer-col">
          <span className="caption">Navigation</span>
          <ul className="footer-links">
            <li><Link href="/">Home &amp; Intake</Link></li>
            <li><Link href="/#scan">New Scan</Link></li>
            <li><a href="/api/ready" target="_blank" rel="noreferrer">API Health (/api/ready)</a></li>
          </ul>
        </div>
      </div>

      <div className="shell">
        <div className="footer-rule" />
        <div className="footer-bottom">
          <span className="caption">
            Astra · Trusted Operator Investigation Client
          </span>
          <span className="caption">
            Inter &amp; JetBrains Mono Editorial Frame
          </span>
        </div>
      </div>
    </footer>
  );
}

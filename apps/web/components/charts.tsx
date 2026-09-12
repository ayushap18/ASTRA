type Bar = { label: string; value: number };

// Charts draw from the block palette. `tone` names a fixed colour (severity, where
// the colour carries meaning); otherwise bars cycle the palette so a long list of
// kinds stays readable. Colour is never the only signal: every bar keeps its value.
const PALETTE = ["lime", "lilac", "cream", "mint", "coral", "pink"] as const;
const SEVERITY_TONE: Record<string, string> = {
  critical: "coral",
  high: "pink",
  medium: "cream",
  low: "mint",
  unknown: "hairline",
};

function toneVar(tone: string) {
  return tone === "hairline" ? "var(--hairline)" : `var(--block-${tone})`;
}

export function Donut({
  value,
  label,
  tone = "lilac",
}: {
  value: number | null | undefined;
  label: string;
  tone?: string;
}) {
  const unknown = value == null || Number.isNaN(value);
  const clamped = unknown ? 0 : Math.max(0, Math.min(100, value));
  const r = 42;
  const c = 2 * Math.PI * r;
  const dash = unknown ? 0 : (clamped / 100) * c;
  return (
    <figure className="chart">
      <svg viewBox="0 0 120 120" width="140" height="140" aria-label={`${label} ${unknown ? "unknown" : clamped}`}>
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--hairline-soft)" strokeWidth="12" />
        {unknown ? null : (
          <circle
            cx="60"
            cy="60"
            r={r}
            fill="none"
            stroke={toneVar(tone)}
            strokeWidth="12"
            strokeDasharray={`${dash} ${c}`}
            strokeLinecap="round"
            transform="rotate(-90 60 60)"
          />
        )}
        <text x="60" y="66" textAnchor="middle" fontSize="18" fontFamily="var(--font-mono), monospace">
          {unknown ? "—" : clamped}
        </text>
      </svg>
      <figcaption className="caption">{label}{unknown ? " · unknown" : ""}</figcaption>
    </figure>
  );
}

export function Bars({ title, items, bySeverity }: { title: string; items: Bar[]; bySeverity?: boolean }) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <figure className="chart">
      <figcaption className="caption">{title}</figcaption>
      <div className="bars">
        {items.map((item, index) => {
          const tone = bySeverity
            ? (SEVERITY_TONE[item.label.toLowerCase()] ?? "hairline")
            : PALETTE[index % PALETTE.length];
          return (
            <div key={item.label} className="bar-row">
              <span className="caption bar-label" title={item.label}>
                {item.label}
              </span>
              <span className="bar-track">
                <span
                  className="bar-fill"
                  style={{ width: `${(item.value / max) * 100}%`, background: toneVar(tone) }}
                />
              </span>
              <span className="caption">{item.value}</span>
            </div>
          );
        })}
      </div>
    </figure>
  );
}

export function Radar({ title, values }: { title: string; values: Record<string, number | null> }) {
  const keys = Object.keys(values);
  const n = keys.length || 1;
  const points = keys.map((key, index) => {
    const raw = values[key];
    const v = (raw ?? 50) / 100;
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / n;
    return `${60 + Math.cos(angle) * 40 * v},${60 + Math.sin(angle) * 40 * v}`;
  });
  return (
    <figure className="chart">
      <svg viewBox="0 0 120 120" width="180" height="180" aria-label={title}>
        <circle cx="60" cy="60" r="40" fill="none" stroke="var(--hairline)" />
        <circle cx="60" cy="60" r="20" fill="none" stroke="var(--hairline-soft)" />
        <polygon
          points={points.join(" ")}
          fill="var(--block-mint)"
          fillOpacity="0.75"
          stroke="var(--ink)"
          strokeWidth="1.5"
        />
      </svg>
      <figcaption className="caption">{title}</figcaption>
    </figure>
  );
}

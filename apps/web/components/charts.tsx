type Bar = { label: string; value: number };

export function Donut({ value, label }: { value: number | null | undefined; label: string }) {
  const unknown = value == null || Number.isNaN(value);
  const clamped = unknown ? 0 : Math.max(0, Math.min(100, value));
  const r = 42;
  const c = 2 * Math.PI * r;
  const dash = unknown ? 0 : (clamped / 100) * c;
  return (
    <figure className="chart">
      <svg viewBox="0 0 120 120" width="140" height="140" aria-label={`${label} ${unknown ? "unknown" : clamped}`}>
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--hairline)" strokeWidth="12" />
        {unknown ? null : (
          <circle
            cx="60"
            cy="60"
            r={r}
            fill="none"
            stroke="currentColor"
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

export function Bars({ title, items }: { title: string; items: Bar[] }) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <figure className="chart">
      <figcaption className="caption">{title}</figcaption>
      <div className="bars">
        {items.map((item) => (
          <div key={item.label} className="bar-row">
            <span className="caption">{item.label}</span>
            <span className="bar-track">
              <span className="bar-fill" style={{ width: `${(item.value / max) * 100}%` }} />
            </span>
            <span className="caption">{item.value}</span>
          </div>
        ))}
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
        <circle cx="60" cy="60" r="40" fill="none" stroke="#e6e6e6" />
        <polygon points={points.join(" ")} fill="rgba(0,0,0,0.12)" stroke="#000" />
      </svg>
      <figcaption className="caption">{title}</figcaption>
    </figure>
  );
}

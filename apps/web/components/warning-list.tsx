/**
 * Collapsed warning list. Native <details> carries the open/closed state and the
 * disclosure marker, so this needs no client JavaScript.
 */
export function WarningList({ warnings, label = "warnings" }: { warnings: string[]; label?: string }) {
  if (!warnings.length) return null;
  return (
    <details className="warnings">
      <summary>
        <span className="caption">
          {warnings.length} {label}
        </span>
        <span className="warnings-marker" aria-hidden="true" />
      </summary>
      <ul className="warning-list scroll-list">
        {warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </details>
  );
}

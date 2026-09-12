import { cn } from "@/lib/utils";

/** `rows` keeps the legacy `<Skeleton rows={n} />` call sites working; plain usage renders one bar. */
function Skeleton({ className, rows, ...props }: React.ComponentProps<"div"> & { rows?: number }) {
  if (rows) {
    return (
      <div className="stack" aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} data-slot="skeleton" className={cn("h-4 rounded-md bg-muted", className)} />
        ))}
      </div>
    );
  }
  return <div data-slot="skeleton" className={cn("rounded-md bg-muted", className)} {...props} />;
}

export { Skeleton };

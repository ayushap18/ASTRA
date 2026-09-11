import Link from "next/link";

export default function ScanNotFound() {
  return (
    <main className="stack">
      <section className="panel stack">
        <p className="eyebrow">Not found</p>
        <h1 className="headline">This scan is not in storage.</h1>
        <p className="body">It may have been pruned, or memory mode dropped it on restart.</p>
        <Link href="/" className="pill primary">
          Back to console
        </Link>
      </section>
    </main>
  );
}

import Link from "next/link";

export default function NotFound() {
  return (
    <main className="workspace stack">
      <section className="panel stack">
        <p className="eyebrow">Not found</p>
        <h1 className="headline">Nothing at this URL.</h1>
        <p className="body">The scan may have been pruned, or this process uses memory storage that resets on restart.</p>
        <Link href="/" className="pill primary">
          Back to console
        </Link>
      </section>
    </main>
  );
}

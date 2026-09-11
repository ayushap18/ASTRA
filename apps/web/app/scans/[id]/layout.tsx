import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ModeNav } from "@/components/mode-nav";
import { ScanProgress } from "@/components/scan-progress";
import { CoreError, getScan } from "@/lib/server";

export const dynamic = "force-dynamic";

export default async function ScanLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let scan;
  try {
    scan = await getScan(id);
  } catch (err) {
    if (err instanceof CoreError && err.status === 404) notFound();
    throw err;
  }
  return (
    <div className="workspace">
      <ScanProgress scanId={id} initial={scan.events} />
      <Suspense fallback={null}>
        <ModeNav scanId={id} />
      </Suspense>
      {children}
    </div>
  );
}

import Link from "next/link";
import type { ReactNode } from "react";
import { RecordsHeader } from "../RecordsHeader";
import { Freshness } from "../DashboardUI";

/** Board and Funnel share a header; only admins get the Funnel tab. */
export function BoardHeader({ view, isAdmin, status }: { view: "board" | "funnel"; isAdmin: boolean; status?: ReactNode }) {
  return <RecordsHeader title={view === "board" ? "Board" : "Funnel by caller"} status={status}
    tabs={isAdmin ? <nav className="team-nav" aria-label="Board pages">
      <Link href="/dashboard/board" aria-current={view === "board" ? "page" : undefined}>Board</Link>
      <Link href="/dashboard/board/funnel" aria-current={view === "funnel" ? "page" : undefined}>Funnel</Link>
    </nav> : undefined}
    actions={<Freshness updatedAt={new Date().toISOString()} />} />;
}

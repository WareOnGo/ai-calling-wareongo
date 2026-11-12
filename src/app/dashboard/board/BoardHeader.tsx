import Link from "next/link";
import type { ReactNode } from "react";
import { RecordsHeader } from "../RecordsHeader";
import { Freshness } from "../DashboardUI";
import { boardHref } from "@/lib/board-filters";

/** Board and Funnel share a header; only admins get the Funnel tab. */
export function BoardHeader({ view, isAdmin, status, employee }: { view: "board" | "funnel"; isAdmin: boolean; status?: ReactNode; employee?: string }) {
  return <RecordsHeader title={view === "board" ? "Board" : "Funnel by caller"} status={status}
    tabs={isAdmin ? <nav className="team-nav" aria-label="Board pages">
      <Link href={boardHref({ employee })} aria-current={view === "board" ? "page" : undefined}>Board</Link>
      <Link href="/dashboard/board/funnel" aria-current={view === "funnel" ? "page" : undefined}>Funnel</Link>
    </nav> : undefined}
    actions={<Freshness updatedAt={new Date().toISOString()} />} />;
}

import Link from "next/link";
import { RecordsHeader } from "../RecordsHeader";
import { Freshness } from "../DashboardUI";
import { IconUsers } from "../icons";

export function TeamHeader({ view, loading = false }: { view: "performance" | "access"; loading?: boolean }) {
  return <RecordsHeader title={view === "performance" ? "Team performance" : "Access control"} icon={<IconUsers size={18}/>}
    meta={<p className="team-intro">{view === "performance" ? "Calls, outcomes and caller coverage at a glance" : "Manage members, caller links and sign-in permissions"}</p>}
    tabs={<nav className="team-nav" aria-label="Team pages">
      <Link href="/dashboard/team" aria-current={view === "performance" ? "page" : undefined}>Performance</Link>
      <Link href="/dashboard/team/access" aria-current={view === "access" ? "page" : undefined}>Access control</Link>
    </nav>}
    actions={loading ? <span className="freshness"><span className="loading-timestamp skeleton"/><button type="button" className="btn-row" disabled>Refresh</button></span> : <Freshness updatedAt={new Date().toISOString()}/>}/>
}

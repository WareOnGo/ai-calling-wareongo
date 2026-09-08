"use client";
import { WorkColumns, WorkHeaders, WorkLegend, WorkStatusBar, WorkResultSummary } from "./WorkTableStructure";
import { WorkFilters } from "./WorkFilters";
import { AssignmentBrief } from "./AssignmentBrief";
import { WorkContext } from "./WorkContext";
import { AiCallStatus } from "./AiCallStatus";
import Link from "next/link";
import { useCallback, useState } from "react";
import type { WorkItem, WorkPage, WorkTotals } from "@/lib/personal-work";
import { hasWorkCriteria, workHref, type WorkFilters as Filters } from "@/lib/work-filters";
import { OutcomeCells } from "../OutcomeCells";
import { CopyText } from "../CopyText";
import { RecordDetails } from "../RecordDetails";
import { Freshness } from "../DashboardUI";
import { IconClipboard } from "../icons";

export function WorkLists({ records, calls, totals, matchingTotals, filters, assigners, updatedAt }: {
  records: WorkPage; calls: WorkPage; totals: WorkTotals; matchingTotals: WorkTotals; filters: Filters;
  assigners: { email: string; name: string | null }[]; updatedAt: string;
}) {
  const [states, setStates] = useState<Record<string, string>>({});
  const onStateChange = useCallback((id: string, state: string) => setStates(prev => prev[id] === state ? prev : { ...prev, [id]: state }), []);
  function delta(rows: WorkItem[]) { return rows.reduce((n, r) => n + (states[r.id] ? Number(states[r.id] === "open") - Number(r.state === "open") : 0), 0); }
  const change = delta(records.rows) + delta(calls.rows);
  const open = totals.record.open + totals.call.open + change;
  const total = totals.record.open + totals.record.done + totals.call.open + totals.call.done;
  const matchingOpen = matchingTotals.record.open + matchingTotals.call.open + change;
  const matchingTotal = matchingTotals.record.open + matchingTotals.record.done + matchingTotals.call.open + matchingTotals.call.done;
  const shownCount = filters.view === "open" ? matchingOpen : filters.view === "done" ? matchingTotal - matchingOpen : matchingTotal;
  const noRows = records.rows.length + calls.rows.length === 0;
  const filtered = hasWorkCriteria(filters);
  function pageHref(entity: "record" | "call", page: number) {
    return workHref(filters, { records_page: String(entity === "record" ? page : records.page), calls_page: String(entity === "call" ? page : calls.page) });
  }
  return <>
    <div className="page-title"><span className="pt-icon"><IconClipboard size={18} /></span>My Work<span className="title-sub">{total ? open ? `${open} still to do` : "all caught up" : ""}</span><Freshness updatedAt={updatedAt} /></div>
    <WorkStatusBar filters={filters} total={matchingTotal} open={matchingOpen} />
    <WorkFilters filters={filters} assigners={assigners} />
    <WorkResultSummary filters={filters} count={shownCount} />
    <WorkLegend />
    <div className="stacked work-content">
      {noRows && <div className="work-empty">
        <span className="work-empty-icon"><IconClipboard size={24} /></span>
        <h2>{!total ? "Nothing is assigned to you yet" : filtered ? "No work matches these filters" : filters.view === "open" ? "You're all caught up" : "No completed work yet"}</h2>
        <p>{!total ? "Your assigned listings and AI follow-ups will appear here, along with instructions from the assigner. Use Refresh to check for new work." : filtered ? "Try a different contact, city or result, or clear your filters." : filters.view === "open" ? "You can review your completed work or refresh to check for new assignments." : "Work appears here when you mark it done."}</p>
        {!!total && <Link className="btn secondary" href={filtered ? workHref({ view: filters.view }) : workHref(filters, { view: undefined })}>{filtered ? "Clear filters" : "View all work"}</Link>}
      </div>}
      {([['record', 'Listings to call', records], ['call', 'AI calls to follow up', calls]] as const).map(([entity,title,list]) => list.rows.length > 0 && <section className="worklist" aria-label={title} data-entity={entity} key={entity}>
        <h2 className="section-head">{title}<span className="count">{matchingTotals[entity].open + delta(list.rows)} left of {matchingTotals[entity].open + matchingTotals[entity].done}</span></h2>
        <div className="gridwrap"><table className="sheet task-sheet">
          <WorkColumns /><WorkHeaders />
          <tbody>{list.rows.map((r,i) => <tr key={r.id} className={(states[r.id] || r.state) === 'done' ? 'row-done' : undefined}>
            <td className="rownum">{(list.page-1)*25+i+1}</td>
            <td className="who"><div className="work-person-heading"><span className="who-name">{r.who}</span><RecordDetails id={r.entityId} entity={entity} /></div>
              <WorkContext context={r.context} />
              <AssignmentBrief id={r.id} note={r.brief} assignedBy={r.assignedBy} name={r.assignedByName} assignedAt={r.assignedAt} />
            </td>
            <td className="work-phone"><CopyText value={r.phone} label="phone number" /><AiCallStatus result={r.ai} count={r.aiCount} /></td>
            <OutcomeCells assignmentId={r.id} outcome={r.outcome} remarks={r.remarks} addedToDb={r.addedToDb} whId={r.whId} state={r.state} onStateChange={onStateChange} />
          </tr>)}</tbody>
        </table></div>
        {list.pages > 1 && <nav className="work-pager" aria-label={`${title} pages`}>
          {list.page > 1 ? <Link className="btn-row" href={pageHref(entity, list.page-1)}>Previous</Link> : <button className="btn-row" disabled>Previous</button>}
          <span>Page {list.page} of {list.pages} · {list.total} {filters.view || ''} assignments</span>
          {list.page < list.pages ? <Link className="btn-row" href={pageHref(entity, list.page+1)}>Next</Link> : <button className="btn-row" disabled>Next</button>}
        </nav>}
      </section>)}
    </div>
  </>;
}

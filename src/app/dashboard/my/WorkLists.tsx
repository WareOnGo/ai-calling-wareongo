"use client";
import { WorkColumns, WorkHeaders, WorkLegend, WorkStatusBar, WorkResultSummary } from "./WorkTableStructure";
import { WorkFilters } from "./WorkFilters";
import { AssignmentBrief } from "./AssignmentBrief";
import { WorkContext } from "./WorkContext";
import { AiCallStatus } from "./AiCallStatus";
import Link from "next/link";
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { WorkItem, WorkPage, WorkTotals } from "@/lib/employee-work";
import { hasWorkCriteria, workHref, type WorkFilters as Filters } from "@/lib/employee-work-filters";
import { OutcomeCells, ReadOnlyOutcomeCells } from "./classic/OutcomeCells";
import { EmployeePerspective, type WorkEmployee } from "./EmployeePerspective";
import { CopyText } from "./classic/CopyText";
import { RecordDetails } from "./classic/RecordDetails";
import { Freshness } from "../DashboardUI";
import { IconClipboard } from "../icons";
import { WarehouseNotice } from "../WarehouseNotice";

type WorkListsProps = {
  records: WorkPage; calls: WorkPage; totals: WorkTotals; matchingTotals: WorkTotals; filters: Filters;
  assigners: { email: string; name: string | null }[]; updatedAt: string;
  employees?: WorkEmployee[]; viewingEmployee?: WorkEmployee;
};

export function WorkLists(props: WorkListsProps) {
  const content = useRef<HTMLDivElement>(null);
  const previousPages = useRef({ record: props.records.page, call: props.calls.page });
  useLayoutEffect(() => {
    const entity = previousPages.current.record !== props.records.page ? "record"
      : previousPages.current.call !== props.calls.page ? "call" : null;
    previousPages.current = { record: props.records.page, call: props.calls.page };
    const scroller = content.current;
    const heading = entity && scroller?.querySelector<HTMLElement>(`[data-entity="${entity}"] .section-head`);
    if (!scroller || !heading) return;
    // Both lists share a scroll container. Reveal the page that changed instead
    // of returning to the unchanged first list when the task rows remount.
    scroller.scrollTop += heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    heading.focus({ preventScroll: true });
  }, [props.records.page, props.calls.page]);
  return <WorkListContents key={`${props.records.page}:${props.calls.page}`} {...props} contentRef={content} />;
}

function WorkListContents({ records, calls, totals, matchingTotals, filters, assigners, employees, viewingEmployee, updatedAt, contentRef }: WorkListsProps & { contentRef: RefObject<HTMLDivElement | null> }) {
  const readOnly = !!viewingEmployee;
  const employeeName = viewingEmployee?.name || viewingEmployee?.email;
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
  let emptyTitle = "No completed work yet";
  let emptyDescription = readOnly ? "Work appears here when this employee marks it done." : "Work appears here when you mark it done.";
  if (!total) {
    emptyTitle = readOnly ? `Nothing is assigned to ${employeeName} yet` : "Nothing is assigned to you yet";
    emptyDescription = readOnly
      ? "This employee's assigned listings and AI follow-ups will appear here. Use Refresh to check for new work."
      : "Your assigned listings and AI follow-ups will appear here, along with instructions from the assigner. Use Refresh to check for new work.";
  } else if (filtered) {
    emptyTitle = "No work matches these filters";
    emptyDescription = "Try a different contact, city or result, or clear your filters.";
  } else if (filters.view === "open") {
    emptyTitle = readOnly ? `${employeeName} is all caught up` : "You're all caught up";
    emptyDescription = readOnly
      ? "Review this employee's completed work or refresh to check for new assignments."
      : "You can review your completed work or refresh to check for new assignments.";
  }
  function pageHref(entity: "record" | "call", page: number) {
    return workHref(filters, { records_page: String(entity === "record" ? page : records.page), calls_page: String(entity === "call" ? page : calls.page) });
  }
  return <>
    <div className="page-title"><span className="pt-icon"><IconClipboard size={18} /></span>My Work<span className="title-sub">{total ? open ? `${open} still to do` : "all caught up" : ""}</span><Freshness updatedAt={updatedAt} /></div>
    {employees && <EmployeePerspective employees={employees} filters={filters} />}
    <WorkStatusBar filters={filters} total={matchingTotal} open={matchingOpen} employeeName={employeeName} />
    <WorkFilters filters={filters} assigners={assigners} />
    <WorkResultSummary filters={filters} count={shownCount} />
    <WorkLegend readOnly={readOnly} />
    <div className="stacked work-content" ref={contentRef}>
      {noRows && <div className="work-empty">
        <span className="work-empty-icon"><IconClipboard size={24} /></span>
        <h2>{emptyTitle}</h2>
        <p>{emptyDescription}</p>
        {!!total && <Link className="btn secondary" href={filtered ? workHref({ view: filters.view, employee: filters.employee }) : workHref(filters, { view: undefined })}>{filtered ? "Clear filters" : "View all work"}</Link>}
      </div>}
      {([['record', 'Listings to call', records], ['call', 'AI calls to follow up', calls]] as const).map(([entity,title,list]) => list.rows.length > 0 && <section className="worklist" aria-label={title} data-entity={entity} key={entity}>
        <h2 className="section-head" tabIndex={-1}>{title}<span className="count">{matchingTotals[entity].open + delta(list.rows)} left of {matchingTotals[entity].open + matchingTotals[entity].done}</span></h2>
        <div className="gridwrap"><table className="sheet task-sheet">
          <WorkColumns /><WorkHeaders readOnly={readOnly} />
          <tbody>{list.rows.map((r,i) => <tr key={r.id} className={[(states[r.id] || r.state) === 'done' && 'row-done', r.warehouseIds.length > 0 && 'row-warehouse-added'].filter(Boolean).join(' ') || undefined}>
            <td className="rownum">{(list.page-1)*25+i+1}</td>
            <td className="who"><div className="work-person-heading"><span className="who-name">{r.who}</span><RecordDetails id={r.entityId} entity={entity} employee={filters.employee} /></div>
              <WorkContext context={r.context} />
              <WarehouseNotice ids={r.warehouseIds} compact />
              <AssignmentBrief id={r.id} note={r.brief} assignedBy={r.assignedBy} name={r.assignedByName} assignedAt={r.assignedAt} />
            </td>
            <td className="work-phone"><CopyText value={r.phone} label="phone number" /><AiCallStatus result={r.ai} count={r.aiCount} /></td>
            {readOnly || r.warehouseIds.length > 0 ? <ReadOnlyOutcomeCells outcome={r.outcome} remarks={r.remarks} addedToDb={r.addedToDb} whId={r.whId} state={r.state} warehouseIds={r.warehouseIds} notesLabel={readOnly ? "Employee notes" : "Your notes"} /> : <OutcomeCells revision={r.revision} assignmentId={r.id} contactName={r.who} phone={r.phone} outcome={r.outcome} remarks={r.remarks} addedToDb={r.addedToDb} whId={r.whId} state={r.state} onStateChange={onStateChange} />}
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

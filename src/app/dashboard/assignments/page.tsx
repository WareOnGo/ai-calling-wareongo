import { RecordDetails } from "../RecordDetails";
import { assignmentFiltersSchema } from "@/lib/filters";
import {dispositionLabel} from "@/lib/manual-dispositions";
import { manualHistorySummaries } from "@/lib/manual-attempts";
import { countFilters, firstValue, filterValues } from "@/lib/filter-values";
import { RecordsPagination } from "../RecordsPagination";
import { RecordsHeader } from "../RecordsHeader";
import { SelectionProvider } from "../Selection";
import { ASSIGNMENT_COLUMNS as COLUMNS } from "../sheet-columns";
import { dateTime as fmt, shortDate } from "@/lib/display";
import { Freshness } from "../DashboardUI";
import { AiAttemptCard } from "../AiAttemptCard";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { listAssignments, assignmentTotals, HISTORY_PAGE_SIZE, type AssignmentHistoryRow } from "@/lib/assignments";
import { listUsers } from "@/lib/users";
import { AssignmentColumns, AssignmentHeaders, AssignmentStats, AssignmentSummary } from "./AssignmentStructure";
import { BulkAssignmentActions } from "./BulkAssignmentActions";
import { AssignmentFilters, ASSIGNMENT_FILTER_KEYS } from "./AssignmentFilters";
import { AssignmentNotes } from "./AssignmentNotes";
import { AssigneeCard } from "./AssigneeCard";
import { ReopenAssignment } from "../ReopenAssignment";
import { UnassignButton } from "../UnassignButton";
import { ContactCard } from "../ContactCard";
import { IconClipboard } from "../icons";
import { ResultBadge } from "../ResultBadge";

export const dynamic = "force-dynamic";

// Read each assignment as contact, ownership, results, then follow-up actions.
// History stays newest first.

// "2h ago" beats "4 Sept 2026, 12:24 am" in a log you scan top-down — and every row
// carried the same long stamp. The exact time stays in the title attribute.
function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 8) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

// The employee's verdict vs what the AI heard. Agreement is the useful signal, so
// a mismatch is called out rather than left for the reader to spot.
function manualResultCard(r: AssignmentHistoryRow, historyCount: number) {
  const ai = (r.ai_availability ?? "").trim();
  const disagrees = r.outcome && r.ai_comparable && ai.toLowerCase() !== r.outcome.toLowerCase();
  return (
    <div className="manual-result-card">
      <div className="manual-result-summary">
        <div className="manual-result-heading">
          <ResultBadge value={r.outcome} empty="No result yet"/>
          {disagrees && r.entity_type === "call" && <span className="review-tag" title={`AI heard "${ai}"`}>≠ AI</span>}
        </div>
        <span className="manual-result-log">{historyCount ? `${historyCount} call ${historyCount === 1 ? "record" : "records"}` : "No call records yet"}</span>
        {r.disposition && <span className="manual-result-log">{dispositionLabel(r.disposition)}</span>}
        {r.closure_reason === "exhausted" && <span className="manual-result-followup">Follow-ups exhausted</span>}
        {r.next_due_at && <span className="manual-result-followup">Follow-up <time dateTime={r.next_due_at}>{fmt(r.next_due_at)}</time></span>}
      </div>
      <RecordDetails id={r.entity_id} entity={r.entity_type} label="Call history" initialSection="Manual activity" className="manual-result-history" title="Callyzer calls and staff logs for this contact">
        <span>Call history</span><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 3 5 5-5 5"/></svg>
      </RecordDetails>
    </div>
  );
}

export default async function Assignments({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireAdmin();
  const sp=await searchParams;

  const parsed = assignmentFiltersSchema.safeParse(sp);
  if (!parsed.success) return <p role="alert">Invalid filters. {parsed.error.issues.map(issue => issue.message).join("; ")} <Link href="/dashboard/assignments">Clear filters</Link></p>;
  const { type, ...criteria } = parsed.data;
  const filters = { ...criteria, entity_type: type, page: Number(firstValue(sp.page) || 1) };

  const [{ rows, total, page, pages }, totals, assignees] = await Promise.all([
    listAssignments(user, filters),
    assignmentTotals(user, sp.assignee, filters),
    listUsers(),
  ]);
  const callHistory=await manualHistorySummaries(user,rows.map(r=>({entity:r.entity_type,id:r.entity_id})));

  const activeFilters = countFilters(sp, ASSIGNMENT_FILTER_KEYS);

  return (
    <SelectionProvider key={JSON.stringify(sp)} total={total}>
      <RecordsHeader title="Assignments" icon={<IconClipboard size={18}/>} actions={<Freshness updatedAt={new Date().toISOString()}/>}/>

      <AssignmentStats applied={sp} totals={totals} assignee={sp.assignee} person={filterValues(sp.assignee).map(email=>assignees.find(p=>p.email===email)?.name||email).join(", ") || undefined} state={sp.state} />
      <AssignmentFilters applied={sp} assignees={assignees} />
      {filters.comparison==='mismatch'&&<p className="mismatch-context">Manual and AI results disagree for the same assigned AI call. Shared-phone listing context and missing results are excluded.</p>}
      <BulkAssignmentActions filters={sp}/>
      <AssignmentSummary>{total.toLocaleString()} {total === 1 ? "assignment" : "assignments"}{activeFilters || sp.q ? " matching filters" : ""}</AssignmentSummary>

      <div className="gridwrap">
        <table className="sheet log-sheet assignment-sheet">
          <AssignmentColumns /><AssignmentHeaders />
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className="selcol"></td>
                <td colSpan={COLUMNS.length} className="muted" style={{ textAlign: "center", padding: 28 }}>
                  {total === 0 && activeFilters === 0 && !sp.q
                    ? "Nothing assigned yet. Use Assign on Raw Dataset or AI Calls."
                    : "No assignments match these filters."}
                  <div className="empty-actions">{total === 0 && activeFilters === 0 && !sp.q ? <><Link href="/dashboard/raw">Open Raw Dataset</Link><Link href="/dashboard/calls">Open AI Calls</Link></> : <Link href="/dashboard/assignments">Clear filters</Link>}</div>
                </td>
              </tr>
            )}
            {rows.map(r => (
              <tr key={r.id} className={r.state === "dropped" ? "row-muted" : undefined}>
                <td className="selcol"><input type="checkbox" className="rowsel" data-id={r.id} aria-label={`Select assignment for ${r.subject || r.phone || r.id}`}/></td>
                <td className="assignment-subject identity-owner"><ContactCard name={r.subject} phone={r.phone} details={{id: r.entity_id, entity: r.entity_type}} /></td>
                <td>{r.city ?? <span className="muted">—</span>}</td>
                <td><span className={`pill pill-${r.entity_type}`}>{r.entity_type === "record" ? "manual" : "AI call"}</span></td>
                <td className="assignment-person">
                  <AssigneeCard id={r.id} name={r.assignee_name} email={r.assignee} assignedBy={r.assigned_by} assignedByName={r.assigned_by_name} assignedAt={r.assigned_at}/>
                </td>
                <td title={`${fmt(r.assigned_at)} · Assigned by ${r.assigned_by}`} className="assignment-date nowrap">{ago(r.assigned_at)}</td>
                <td><span className={`pill pill-${r.state}`}>{r.state === "dropped" ? "unassigned" : r.state}</span>{r.state === "done" && <span className="record-meta assignment-completed">{r.completed_at ? <time dateTime={r.completed_at} title={`Completed ${fmt(r.completed_at)}`}>{shortDate(r.completed_at)}</time> : "Date not recorded"}</span>}</td>
                <td className="assignment-brief">{r.note || <span className="muted">—</span>}</td>
                <td title={r.entity_type === "record" ? "AI context from a shared phone; may describe another property" : "AI result for this execution"}><ResultBadge value={r.ai_availability} empty="No AI result"/>{r.entity_type === "record" && r.ai_availability && <small className="record-meta">contact context</small>}</td>
                <td className="record-history"><AiAttemptCard entity={r.entity_type} id={r.entity_id} summary={r.ai_summary}/></td>
                <td>{manualResultCard(r,callHistory.get(`${r.entity_type}:${r.entity_id}`)!.total)}</td>
                <td className="assignment-note-cell"><AssignmentNotes text={r.remarks} /></td>
                <td>{r.added_to_db ? <span className="pill pill-available">yes</span> : <span className="muted">no</span>}</td>
                <td>{r.wh_id ?? <span className="muted">—</span>}</td>
                <td className="actions">
                  {r.state === "done" && <ReopenAssignment id={r.id} revision={r.revision}/>}
                  {r.state === "open" && <UnassignButton id={r.id} who={r.assignee_name || r.assignee} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <RecordsPagination page={page} pages={pages} total={total} pageSize={HISTORY_PAGE_SIZE} applied={sp} empty="No assignments"/>

    </SelectionProvider>
  );
}

import { assignmentFiltersSchema } from "@/lib/filters";
import {dispositionLabel} from "@/lib/manual-dispositions";
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
function resultCell(r: AssignmentHistoryRow) {
  if (!r.outcome) return <span className="muted">—</span>;
  const ai = (r.ai_availability ?? "").trim();
  const disagrees = ai && ai.toLowerCase() !== r.outcome.toLowerCase();
  return (
    <>
      <ResultBadge value={r.outcome}/>
      {disagrees && r.entity_type === "call" && <span className="review-tag" title={`AI heard "${ai}"`}>≠ AI</span>}
    </>
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

  const startRow = (page - 1) * HISTORY_PAGE_SIZE;
  const activeFilters = countFilters(sp, ASSIGNMENT_FILTER_KEYS);

  return (
    <SelectionProvider total={total}>
      <RecordsHeader title="Assignments" icon={<IconClipboard size={18}/>} actions={<Freshness updatedAt={new Date().toISOString()}/>}/>

      <AssignmentStats applied={sp} totals={totals} assignee={sp.assignee} person={filterValues(sp.assignee).map(email=>assignees.find(p=>p.email===email)?.name||email).join(", ") || undefined} state={sp.state} />
      <AssignmentFilters applied={sp} assignees={assignees} />
      <AssignmentSummary sort={filters.sort}>{total.toLocaleString()} {total === 1 ? "assignment" : "assignments"}{activeFilters || sp.q ? " matching filters" : ""}</AssignmentSummary>

      <div className="gridwrap">
        <table className="sheet log-sheet assignment-sheet">
          <AssignmentColumns /><AssignmentHeaders />
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className="rownum"></td>
                <td colSpan={COLUMNS.length} className="muted" style={{ textAlign: "center", padding: 28 }}>
                  {total === 0 && activeFilters === 0 && !sp.q
                    ? "Nothing assigned yet. Use Assign on Raw Dataset or AI Calls."
                    : "No assignments match these filters."}
                  <div className="empty-actions">{total === 0 && activeFilters === 0 && !sp.q ? <><Link href="/dashboard/raw">Open Raw Dataset</Link><Link href="/dashboard/calls">Open AI Calls</Link></> : <Link href="/dashboard/assignments">Clear filters</Link>}</div>
                </td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={r.id} className={r.state === "dropped" ? "row-muted" : undefined}>
                <td className="rownum">{startRow + i + 1}</td>
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
                <td>{resultCell(r)}<span className="record-meta">{dispositionLabel(r.disposition)}{r.closure_reason==='exhausted'&&' · Exhausted'}{r.next_due_at&&<><br/>Due {fmt(r.next_due_at)}</>}</span></td>
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

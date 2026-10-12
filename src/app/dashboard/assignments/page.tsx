import {dispositionLabel} from "@/lib/manual-dispositions";
import { firstValue, filterValues, searchQuery, type SearchValues } from "@/lib/filter-values";
import { RecordsPagination } from "../RecordsPagination";
import { AssignmentNotices } from "../GridNotices";
import { SelectionProvider } from "../Selection";
import { ASSIGNMENT_COLUMNS as COLUMNS } from "../sheet-columns";
import { dateTime as fmt } from "@/lib/display";
import { Freshness } from "../DashboardUI";
import { RecordDetails } from "../RecordDetails";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { listAssignments, assignmentTotals, HISTORY_PAGE_SIZE, type AssignmentHistoryRow } from "@/lib/assignments";
import { listUsers } from "@/lib/users";
import { AssignmentColumns, AssignmentHeaders, AssignmentStats } from "./AssignmentStructure";
import { AssignmentFilters } from "./AssignmentFilters";
import { AssignmentNotes } from "./AssignmentNotes";
import { ReopenAssignment } from "../ReopenAssignment";
import { UnassignButton } from "../UnassignButton";
import { CopyText } from "../CopyText";
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

type SP=SearchValues;
function qs(base:SP,override:SP){return `?${searchQuery({...base,...override})}`;}

export default async function Assignments({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireAdmin();
  const sp=await searchParams;

  const filters = {
    q: firstValue(sp.q), assignee: sp.assignee, state: sp.state, batch_id: firstValue(sp.batch_id),
    entity_type: sp.type, outcome: sp.outcome, quality_review:sp.quality_review === "1",follow_up:sp.follow_up === "due" ? "due" as const : sp.follow_up === "pending" ? "pending" as const : undefined,
    page: Number(firstValue(sp.page)||1),
  };

  const [{ rows, total, page, pages }, totals, assignees] = await Promise.all([
    listAssignments(user, filters),
    assignmentTotals(user, sp.assignee),
    listUsers(),
  ]);

  const startRow = (page - 1) * HISTORY_PAGE_SIZE;
  const activeFilters = ["assignee", "state", "type", "outcome"].filter((k) => sp[k]).length;

  return (
    <SelectionProvider total={total}>
      <div className="page-title">
        <span className="pt-icon"><IconClipboard size={18} /></span> Assignments <Freshness updatedAt={new Date().toISOString()} />
      </div>

      <AssignmentStats totals={totals} assignee={sp.assignee} person={filterValues(sp.assignee).map(email=>assignees.find(p=>p.email===email)?.name||email).join(", ") || undefined} state={sp.state} />
      <AssignmentFilters applied={sp} assignees={assignees} /><AssignmentNotices />
      <div className="assignment-summary"><span>{total.toLocaleString()} {total === 1 ? "assignment" : "assignments"}{activeFilters || sp.q ? " matching filters" : ""}</span><span>Newest first</span></div>

      <div className="gridwrap">
        <table className="sheet log-sheet assignment-sheet">
          <AssignmentColumns /><AssignmentHeaders />
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className="rownum"></td>
                <td colSpan={COLUMNS.length} className="muted" style={{ textAlign: "center", padding: 28 }}>
                  {total === 0 && activeFilters === 0 && !sp.q
                    ? "Nothing assigned yet. Use Assign on Raw Dataset or Call Analytics."
                    : "No assignments match these filters."}
                  <div className="empty-actions">{total === 0 && activeFilters === 0 && !sp.q ? <><Link href="/dashboard/raw">Open Raw Dataset</Link><Link href="/dashboard/calls">Open Call Analytics</Link></> : <Link href="/dashboard/assignments">Clear filters</Link>}</div>
                </td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={r.id} className={r.state === "dropped" ? "row-muted" : undefined}>
                <td className="rownum">{startRow + i + 1}</td>
                <td className="assignment-subject identity-owner">{r.subject ?? <span className="muted">—</span>} <RecordDetails id={r.entity_id} entity={r.entity_type} /></td>
                <td><CopyText value={r.phone} label="phone number" /></td>
                <td>{r.city ?? <span className="muted">—</span>}</td>
                <td><span className={`pill pill-${r.entity_type}`}>{r.entity_type === "record" ? "manual" : "AI call"}</span></td>
                <td className="assignment-person" title={r.assignee}>
                  <Link className="assignee-name" href={qs(sp, { assignee: r.assignee, page: undefined })} title={`Show assignments for ${r.assignee_name || r.assignee}`}>{r.assignee_name || r.assignee}</Link>
                  {r.assignee_name && <span className="assignee-email">{r.assignee}</span>}
                </td>
                <td title={`${fmt(r.assigned_at)} · Assigned by ${r.assigned_by}`} className="assignment-date nowrap">{ago(r.assigned_at)}</td>
                <td><span className={`pill pill-${r.state}`}>{r.state === "dropped" ? "unassigned" : r.state}</span></td>
                <td className="assignment-brief">{r.note || <span className="muted">—</span>}</td>
                <td title={r.entity_type === "record" ? "AI context from a shared phone; may describe another property" : "AI result for this execution"}><ResultBadge value={r.ai_availability} empty="No AI result"/>{r.entity_type === "record" && r.ai_availability && <small className="record-meta">contact context</small>}</td>
                <td>{resultCell(r)}<span className="record-meta">{dispositionLabel(r.disposition)}{r.closure_reason==='exhausted'&&' · Exhausted'}{r.next_due_at&&<><br/>Due {fmt(r.next_due_at)}</>}</span></td>
                <td className="assignment-note-cell"><AssignmentNotes text={r.remarks} /></td>
                <td>{r.added_to_db ? <span className="pill pill-available">yes</span> : <span className="muted">no</span>}</td>
                <td>{r.wh_id ?? <span className="muted">—</span>}</td>
                <td className="actions">
                  {r.state === "done" && <ReopenAssignment id={r.id} revision={r.revision}/>}<RecordDetails id={r.entity_id} entity={r.entity_type} label="History"/>
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

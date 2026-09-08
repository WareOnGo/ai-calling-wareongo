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
import { UnassignButton } from "../UnassignButton";
import { CopyText } from "../CopyText";
import { GridInteractivity } from "../GridInteractivity";
import { IconClipboard } from "../icons";

export const dynamic = "force-dynamic";

// Keep the assignee and their follow-up notes first; history stays newest first.

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
      <span className={`pill pill-${r.outcome.toLowerCase()}`}>{r.outcome}</span>
      {disagrees && <span className="review-tag" title={`AI heard "${ai}"`}>≠ AI</span>}
    </>
  );
}

type SP = Record<string, string | undefined>;
function qs(base: SP, override: SP) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...override })) if (v) p.set(k, v);
  return `?${p.toString()}`;
}

export default async function Assignments({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const rawSp = await searchParams;
  const sp: SP = {};
  for (const [k, v] of Object.entries(rawSp)) sp[k] = Array.isArray(v) ? v[0] : v;

  const filters = {
    q: sp.q, assignee: sp.assignee, state: sp.state,
    entity_type: sp.type, outcome: sp.outcome,
    page: sp.page ? Number(sp.page) : 1,
  };

  const [{ rows, total, page, pages }, totals, assignees] = await Promise.all([
    listAssignments(filters),
    assignmentTotals(sp.assignee),
    listUsers(),
  ]);

  const startRow = (page - 1) * HISTORY_PAGE_SIZE;
  const activeFilters = ["assignee", "state", "type", "outcome"].filter((k) => sp[k]).length;

  return (
    <>
      <div className="page-title">
        <span className="pt-icon"><IconClipboard size={18} /></span> Assignments <Freshness updatedAt={new Date().toISOString()} />
      </div>

      <AssignmentStats totals={totals} assignee={sp.assignee} person={assignees.find(person => person.email === sp.assignee)?.name || undefined} state={sp.state} />
      <AssignmentFilters applied={sp} assignees={assignees} />
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
                <td className="assignment-person" title={r.assignee}>
                  <Link className="assignee-name" href={qs(sp, { assignee: r.assignee, page: undefined })} title={`Show assignments for ${r.assignee_name || r.assignee}`}>{r.assignee_name || r.assignee}</Link>
                  {r.assignee_name && <span className="assignee-email">{r.assignee}</span>}
                </td>
                <td className="assignment-note-cell"><AssignmentNotes text={r.remarks} /></td>
                <td><span className={`pill pill-${r.state}`}>{r.state === "dropped" ? "unassigned" : r.state}</span></td>
                <td>{resultCell(r)}</td>
                <td className="assignment-subject">{r.subject ?? <span className="muted">—</span>} <RecordDetails id={r.entity_id} entity={r.entity_type} /></td>
                <td><CopyText value={r.phone} label="phone number" /></td>
                <td>{r.city ?? <span className="muted">—</span>}</td>
                <td><span className={`pill pill-${r.entity_type}`}>{r.entity_type === "record" ? "manual" : "AI call"}</span></td>
                <td title={`${fmt(r.assigned_at)} · Assigned by ${r.assigned_by}`} className="assignment-date nowrap">{ago(r.assigned_at)}</td>
                <td>{r.added_to_db ? <span className="pill pill-available">yes</span> : <span className="muted">no</span>}</td>
                <td>{r.wh_id ?? <span className="muted">—</span>}</td>
                <td className="assignment-brief">{r.note || <span className="muted">—</span>}</td>
                <td className="actions">
                  {r.state === "open" && <UnassignButton id={r.id} who={r.assignee_name || r.assignee} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pager">
        <span className="muted">
          {total === 0 ? "No assignments"
            : `${(startRow + 1).toLocaleString()}–${Math.min(startRow + HISTORY_PAGE_SIZE, total).toLocaleString()} of ${total.toLocaleString()}`}
        </span>
        <div className="pages">
          {page <= 1 ? <button type="button" disabled aria-label="First">«</button> : <Link href={qs(sp, { page: "1" })} aria-label="First">«</Link>}
          {page <= 1 ? <button type="button" disabled aria-label="Prev">‹</button> : <Link href={qs(sp, { page: String(page - 1) })} aria-label="Prev">‹</Link>}
          <span className="cur">{page}</span>
          {page >= pages ? <button type="button" disabled aria-label="Next">›</button> : <Link href={qs(sp, { page: String(page + 1) })} aria-label="Next">›</Link>}
          {page >= pages ? <button type="button" disabled aria-label="Last">»</button> : <Link href={qs(sp, { page: String(pages) })} aria-label="Last">»</Link>}
          <span className="muted">{page}/{pages}</span>
        </div>
      </div>

      <GridInteractivity key={JSON.stringify(sp)} />
    </>
  );
}

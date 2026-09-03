import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { listAssignments, assignmentTotals, HISTORY_PAGE_SIZE, type AssignmentHistoryRow } from "@/lib/assignments";
import { listAssignees } from "@/lib/users";
import { OUTCOMES } from "@/lib/scope";
import { ApplyButton } from "../ApplyButton";
import { FiltersToggle } from "../FiltersToggle";
import { UnassignButton } from "../UnassignButton";
import { CopyText } from "../CopyText";
import { GridInteractivity } from "../GridInteractivity";
import { IconClipboard } from "../icons";

export const dynamic = "force-dynamic";

// Admin answer to "who did I give this to, and what happened?" — one page covering
// both channels and all three states. Deliberately NOT the same shape as the two
// spreadsheet grids: this is a log, read top-down, newest first.

const COLUMNS = [
  "Assigned", "Type", "Who", "Phone", "City", "Assignee",
  "Status", "Result", "In DB", "WH ID", "Remarks", "Brief", "",
];

function fmt(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleString("en-IN", { dateStyle: "medium" });
}

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
    assignmentTotals(),
    listAssignees(),
  ]);

  const startRow = (page - 1) * HISTORY_PAGE_SIZE;
  const activeFilters = ["assignee", "state", "type", "outcome"].filter((k) => sp[k]).length;

  return (
    <>
      <div className="page-title">
        <span className="pt-icon"><IconClipboard size={18} /></span> Assignments
      </div>

      {/* Headline counts span the whole table, not the filtered page — they are the
          "where does the work stand" answer, independent of what's being browsed. */}
      <div className="stat-row">
        <Link className="stat" href="/dashboard/assignments?state=open">
          <span className="stat-n">{totals.open.toLocaleString()}</span>
          <span className="stat-l">open</span>
        </Link>
        <Link className="stat" href="/dashboard/assignments?state=done">
          <span className="stat-n">{totals.done.toLocaleString()}</span>
          <span className="stat-l">done</span>
        </Link>
        <Link className="stat" href="/dashboard/assignments?state=dropped">
          <span className="stat-n">{totals.dropped.toLocaleString()}</span>
          <span className="stat-l">unassigned</span>
        </Link>
        <div className="stat stat-quiet">
          <span className="stat-n">{totals.people.toLocaleString()}</span>
          <span className="stat-l">people with open work</span>
        </div>
      </div>

      <form className="filterbar" method="GET" action="/dashboard/assignments">
        <div className="search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Search owner, phone, city, assignee, remarks…" />
        </div>
        <FiltersToggle count={activeFilters} />
        <span className="spacer" />
        <ApplyButton />
        <a className="btn-text" href="/dashboard/assignments">Reset</a>

        <div className="filters-panel">
          <div className={`chip${sp.assignee ? " active" : ""}`}>
            <select name="assignee" defaultValue={sp.assignee ?? ""}>
              <option value="">Anyone</option>
              {assignees.map((a) => <option key={a.email} value={a.email}>{a.name || a.email}</option>)}
            </select>
          </div>
          <div className={`chip${sp.state ? " active" : ""}`}>
            <select name="state" defaultValue={sp.state ?? ""}>
              <option value="">Any status</option>
              <option value="open">Open</option>
              <option value="done">Done</option>
              <option value="dropped">Unassigned</option>
            </select>
          </div>
          <div className={`chip${sp.type ? " active" : ""}`}>
            <select name="type" defaultValue={sp.type ?? ""}>
              <option value="">Both channels</option>
              <option value="record">Manual (listing)</option>
              <option value="call">AI call follow-up</option>
            </select>
          </div>
          <div className={`chip${sp.outcome ? " active" : ""}`}>
            <select name="outcome" defaultValue={sp.outcome ?? ""}>
              <option value="">Any result</option>
              <option value="none">No result yet</option>
              {OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </div>
      </form>

      <div className="gridwrap">
        <table className="sheet log-sheet">
          <thead>
            <tr className="colheads">
              <th className="rowgutter"></th>
              {COLUMNS.map((c, i) => (
                <th key={c || `blank${i}`}
                    className={c === "" ? "acts" : undefined}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className="rownum"></td>
                <td colSpan={COLUMNS.length} className="muted" style={{ textAlign: "center", padding: 28 }}>
                  {total === 0 && activeFilters === 0 && !sp.q
                    ? "Nothing assigned yet. Use Assign on Raw Dataset or Call Analytics."
                    : "No assignments match these filters."}
                </td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={r.id} className={r.state === "dropped" ? "row-muted" : undefined}>
                <td className="rownum">{startRow + i + 1}</td>
                <td title={new Date(r.assigned_at).toLocaleString("en-IN")} className="nowrap">
                  {ago(r.assigned_at)}
                </td>
                <td>
                  <span className={`pill pill-${r.entity_type}`}>
                    {r.entity_type === "record" ? "manual" : "AI call"}
                  </span>
                </td>
                <td>{r.subject ?? <span className="muted">—</span>}</td>
                <td><CopyText value={r.phone} label="phone number" /></td>
                <td>{r.city ?? <span className="muted">—</span>}</td>
                <td title={`assigned by ${r.assigned_by}`}>{r.assignee_name || r.assignee}</td>
                <td><span className={`pill pill-${r.state}`}>{r.state === "dropped" ? "unassigned" : r.state}</span></td>
                <td>{resultCell(r)}</td>
                <td>
                  {r.added_to_db
                    ? <span className="pill pill-available">yes</span>
                    : <span className="muted">no</span>}
                </td>
                <td>{r.wh_id ?? <span className="muted">—</span>}</td>
                <td className="clip" title={r.remarks ?? ""}>{r.remarks ?? <span className="muted">—</span>}</td>
                <td className="clip" title={r.note ?? ""}>{r.note ?? <span className="muted">—</span>}</td>
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
          <Link className={page <= 1 ? "disabled" : ""} href={qs(sp, { page: "1" })} aria-label="First">«</Link>
          <Link className={page <= 1 ? "disabled" : ""} href={qs(sp, { page: String(page - 1) })} aria-label="Prev">‹</Link>
          <span className="cur">{page}</span>
          <Link className={page >= pages ? "disabled" : ""} href={qs(sp, { page: String(page + 1) })} aria-label="Next">›</Link>
          <Link className={page >= pages ? "disabled" : ""} href={qs(sp, { page: String(pages) })} aria-label="Last">»</Link>
          <span className="muted">{page}/{pages}</span>
        </div>
      </div>

      <GridInteractivity />
    </>
  );
}

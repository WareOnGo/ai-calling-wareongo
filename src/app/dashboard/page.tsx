import Link from "next/link";
import { getCalls, getFilterOptions, calledByOptions, type CallFilters, type CallRow } from "@/lib/calls";
import { GridInteractivity } from "./GridInteractivity";
import { EditableCells } from "./EditableCells";
import { ApplyButton } from "./ApplyButton";

export const dynamic = "force-dynamic";

const COLUMNS = [
  "When", "Dir", "Number", "Owner", "Area", "Availability",
  "Segment", "Sqft", "Rent", "Conf", "Notes", "Status", "Recording", "Transcript",
  "Call Status", "Called By", "Added", "WH ID",
];

// Build a compact page list with ellipses: 1 … 4 5 [6] 7 8 … 20
function pageList(page: number, pages: number): (number | "…")[] {
  const set = new Set<number>();
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) set.add(p);
  }
  const sorted = [...set].sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) out.push("…");
    out.push(p);
    prev = p;
  }
  return out;
}

function colLetter(i: number) {
  return String.fromCharCode(65 + i); // A, B, C, …
}

function cfClass(availability: string | null) {
  const v = (availability ?? "").toLowerCase();
  if (v === "available") return "cf-green";
  if (v === "unavailable") return "cf-red";
  if (v.startsWith("dead")) return "cf-gray";
  return "cf-yel"; // Unclear
}

function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

type SP = Record<string, string | undefined>;

function qs(base: SP, override: SP) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...override })) if (v) p.set(k, v);
  return `?${p.toString()}`;
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const sp: SP = {};
  for (const [k, v] of Object.entries(raw)) sp[k] = Array.isArray(v) ? v[0] : v;

  const filters: CallFilters = {
    q: sp.q,
    availability: sp.availability,
    segment: sp.segment,
    agent_id: sp.agent_id,
    status: sp.status,
    confidence: sp.confidence,
    needs_review: sp.needs_review === "1",
    page: sp.page ? Number(sp.page) : 1,
  };

  const [{ rows, total, page, pages, pageSize }, opts] = await Promise.all([
    getCalls(filters),
    getFilterOptions(),
  ]);
  const cbOpts = calledByOptions();

  const numCols = COLUMNS.length;
  const startRow = (page - 1) * pageSize;

  return (
    <>
      {/* Filters — Google-style chips */}
      <form className="filterbar" method="GET" action="/dashboard">
        <div className="search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Search number, owner, transcript" />
        </div>

        <div className={`chip${sp.availability ? " active" : ""}`}>
          <select name="availability" defaultValue={sp.availability ?? ""}>
            <option value="">Availability</option>
            {opts.availabilities.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div className={`chip${sp.segment ? " active" : ""}`}>
          <select name="segment" defaultValue={sp.segment ?? ""}>
            <option value="">Segment</option>
            {opts.segments.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div className={`chip${sp.agent_id ? " active" : ""}`}>
          <select name="agent_id" defaultValue={sp.agent_id ?? ""}>
            <option value="">Agent</option>
            {opts.agents.map((v) => <option key={v} value={v}>{v.slice(0, 8)}…</option>)}
          </select>
        </div>
        <div className={`chip${sp.status ? " active" : ""}`}>
          <select name="status" defaultValue={sp.status ?? ""}>
            <option value="">Status</option>
            {opts.statuses.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div className={`chip${sp.confidence ? " active" : ""}`}>
          <select name="confidence" defaultValue={sp.confidence ?? ""}>
            <option value="">Confidence</option>
            {opts.confidences.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>

        <label className={`toggle${sp.needs_review === "1" ? " active" : ""}`}>
          <input type="checkbox" name="needs_review" value="1" defaultChecked={sp.needs_review === "1"} />
          Needs review
        </label>

        <span className="spacer" />
        <ApplyButton />
        <a className="btn-text" href="/dashboard">Reset</a>
      </form>

      <div className="gridwrap">
        <table className="sheet">
          <thead>
            <tr className="colletters">
              <th className="corner"></th>
              {COLUMNS.map((_, i) => <th key={i}>{colLetter(i)}</th>)}
            </tr>
            <tr className="colheads">
              <th className="rowgutter"></th>
              {COLUMNS.map((c) => <th key={c}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className="rownum"></td>
                <td colSpan={numCols} className="muted" style={{ textAlign: "center", padding: 24 }}>
                  No calls match these filters.
                </td>
              </tr>
            )}
            {rows.map((r: CallRow, i) => (
              <tr key={r.id}>
                <td className="rownum">{startRow + i + 1}</td>
                <td>{fmtDate(r.call_created_at)}</td>
                <td>{r.call_type === "inbound" ? "In" : "Out"}</td>
                <td>{r.call_type === "inbound" ? r.from_number : r.to_number}</td>
                <td>{r.owner_name ?? ""}</td>
                <td>{r.db_area ?? ""}</td>
                <td className={cfClass(r.availability)}>
                  {r.availability ?? ""}
                  {r.needs_review && <span className="review-tag">review</span>}
                </td>
                <td>{r.segment || ""}</td>
                <td>{r.built_up_area_sqft || ""}</td>
                <td>{r.expected_rent || ""}</td>
                <td>{r.confidence ?? ""}</td>
                <td className="clip" title={r.notes ?? ""}>{r.notes ?? ""}</td>
                <td>{r.status}</td>
                <td>{r.recording_url ? <a href={r.recording_url} target="_blank" rel="noreferrer">Play</a> : ""}</td>
                <td className="clip" title={r.transcript ?? ""}>{r.transcript ?? ""}</td>
                <EditableCells
                  id={r.id}
                  callStatus={r.call_status}
                  calledBy={r.called_by}
                  addedToDb={r.added_to_db}
                  whId={r.wh_id}
                  calledByOptions={cbOpts}
                />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pager">
        <span className="muted">
          {total === 0 ? "No results" : `${(startRow + 1).toLocaleString()}–${Math.min(startRow + pageSize, total).toLocaleString()} of ${total.toLocaleString()}`}
        </span>
        <div className="pages">
          <Link className={page <= 1 ? "disabled" : ""} href={qs(sp, { page: "1" })} aria-label="First">«</Link>
          <Link className={page <= 1 ? "disabled" : ""} href={qs(sp, { page: String(page - 1) })} aria-label="Prev">‹</Link>
          {pageList(page, pages).map((t, i) =>
            t === "…"
              ? <span key={`e${i}`} className="ellipsis">…</span>
              : t === page
                ? <span key={t} className="cur">{t}</span>
                : <Link key={t} href={qs(sp, { page: String(t) })}>{t}</Link>,
          )}
          <Link className={page >= pages ? "disabled" : ""} href={qs(sp, { page: String(page + 1) })} aria-label="Next">›</Link>
          <Link className={page >= pages ? "disabled" : ""} href={qs(sp, { page: String(pages) })} aria-label="Last">»</Link>
        </div>
      </div>
      <GridInteractivity />
    </>
  );
}

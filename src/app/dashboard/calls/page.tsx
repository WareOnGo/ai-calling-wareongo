import Link from "next/link";
import { getCalls, getFilterOptions, calledByOptions, type CallFilters, type CallRow, type RawMatch } from "@/lib/calls";
import { GridInteractivity } from "../GridInteractivity";
import { EditableCells } from "../EditableCells";
import { ApplyButton } from "../ApplyButton";
import { GroupToggle } from "../GroupToggle";
import { ColumnResize } from "../ColumnResize";
import { IconPhone, IconDownload } from "../icons";
import { FiltersToggle } from "../FiltersToggle";

export const dynamic = "force-dynamic";

const COLUMNS = [
  "When", "Direction", "Number", "Owner", "Area", "Availability", "Sqft", "Rent",
  "AI Call Details", "Notes", "Transcript", "Recording",
  "DB", "DB Owner", "DB Type", "DB City", "DB State", "DB Sqft", "All Sources",
  "Call Status", "Called By", "Added", "WH ID",
];

// Collapsible column groups: a green toggle column (always shown, holds a summary
// value) that collapses/expands its detail columns.
//  - "AI Call Details": summary = Status; collapses Notes / Transcript / Recording
//  - "DB":              summary = Source; collapses the matched-listing detail columns
const GROUPS = [
  { key: "call", toggle: "AI Call Details", members: ["Notes", "Transcript", "Recording"] },
  { key: "db", toggle: "DB", members: ["DB Owner", "DB Type", "DB City", "DB State", "DB Sqft", "All Sources"] },
];
function colClass(label: string): string | undefined {
  for (const g of GROUPS) {
    if (label === g.toggle) return `${g.key}-toggle grp-toggle`;
    if (g.members.includes(label)) return `${g.key}-col`;
  }
  return undefined;
}

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

// Wrap any occurrences of the search terms in <mark> for highlighting.
function hl(text: string | null | undefined, terms: string[]): React.ReactNode {
  const s = text ?? "";
  if (!s || terms.length === 0) return s;
  const esc = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).filter(Boolean);
  if (esc.length === 0) return s;
  const parts = s.split(new RegExp(`(${esc.join("|")})`, "ig"));
  const isMatch = (p: string) => esc.some((e) => new RegExp(`^${e}$`, "i").test(p));
  return parts.map((p, i) => (isMatch(p) ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>));
}

// Full list for the hover tooltip on the matched-owner cell — one matched listing per line.
function matchesTooltip(matches: RawMatch[] | null): string {
  if (!matches || matches.length === 0) return "";
  return matches
    .map((m) => {
      const loc = [m.city, m.state].filter(Boolean).join(", ");
      const tag = m.contact_type === "probable broker" ? " [broker]" : "";
      return `${m.source} · ${m.owner_name ?? "—"}${loc ? ` · ${loc}` : ""}${m.area_sqft ? ` · ${m.area_sqft} sqft` : ""}${tag}`;
    })
    .join("\n");
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
    agent_id: sp.agent_id,
    status: sp.status,
    source: sp.source,
    state: sp.state,
    contact: sp.contact,
    call_type: sp.call_type,
    date_from: sp.date_from,
    date_to: sp.date_to,
    needs_review: sp.needs_review === "1",
    page: sp.page ? Number(sp.page) : 1,
  };

  const [{ rows, total, page, pages, pageSize, terms }, opts] = await Promise.all([
    getCalls(filters),
    getFilterOptions(),
  ]);
  const cbOpts = calledByOptions();

  const numCols = COLUMNS.length;
  const startRow = (page - 1) * pageSize;

  // Export link mirrors the currently-applied filters (not pagination) so the CSV
  // contains the whole filtered set, however many pages it spans.
  const exportParams = new URLSearchParams();
  for (const k of ["q", "availability", "agent_id", "status", "source", "state", "contact", "call_type", "date_from", "date_to", "needs_review"]) {
    if (sp[k]) exportParams.set(k, sp[k] as string);
  }
  const exportHref = `/api/calls/export?${exportParams.toString()}`;

  // active filter count (everything except free-text search) for the Filters badge
  const activeFilters = ["availability", "call_type", "source", "state", "contact", "agent_id", "status", "date_from", "date_to", "needs_review"]
    .filter((k) => sp[k]).length;

  return (
    <>
      <div className="page-title"><span className="pt-icon"><IconPhone size={18} /></span> Call Analytics</div>
      {/* Filters — Google-style chips */}
      <form className="filterbar" method="GET" action="/dashboard/calls">
        <div className="search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Fuzzy search — number, owner, source, state, transcript…" />
        </div>

        <FiltersToggle count={activeFilters} />

        <span className="spacer" />
        <a className="btn-export" href={exportHref}><IconDownload size={15} /> Export CSV</a>
        <ApplyButton />
        <a className="btn-text" href="/dashboard/calls">Reset</a>

        <div className="filters-panel">
            <label className={`datefld${sp.date_from ? " active" : ""}`}>
              <span>From</span>
              <input type="date" name="date_from" defaultValue={sp.date_from ?? ""} />
            </label>
            <label className={`datefld${sp.date_to ? " active" : ""}`}>
              <span>To</span>
              <input type="date" name="date_to" defaultValue={sp.date_to ?? ""} />
            </label>
            <div className={`chip${sp.availability ? " active" : ""}`}>
              <select name="availability" defaultValue={sp.availability ?? ""}>
                <option value="">Availability</option>
                {opts.availabilities.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div className={`chip${sp.call_type ? " active" : ""}`}>
              <select name="call_type" defaultValue={sp.call_type ?? ""}>
                <option value="">Direction</option>
                <option value="inbound">Inbound</option>
                <option value="outbound">Outbound</option>
              </select>
            </div>
            <div className={`chip${sp.source ? " active" : ""}`}>
              <select name="source" defaultValue={sp.source ?? ""}>
                <option value="">DB Source</option>
                {opts.sources.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div className={`chip${sp.state ? " active" : ""}`}>
              <select name="state" defaultValue={sp.state ?? ""}>
                <option value="">DB State</option>
                {opts.states.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div className={`chip${sp.contact ? " active" : ""}`}>
              <select name="contact" defaultValue={sp.contact ?? ""}>
                <option value="">Contact</option>
                <option value="owner">Owner</option>
                <option value="broker">Broker</option>
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
            <label className={`toggle${sp.needs_review === "1" ? " active" : ""}`}>
              <input type="checkbox" name="needs_review" value="1" defaultChecked={sp.needs_review === "1"} />
              Needs review
            </label>
        </div>
      </form>

      <div className="gridwrap">
        <table className="sheet db-collapsed call-collapsed">
          <thead>
            <tr className="colheads">
              <th className="rowgutter"></th>
              {COLUMNS.map((c) => {
                const g = GROUPS.find((g) => g.toggle === c);
                return g
                  ? <GroupToggle key={c} group={g.key} label={c} />
                  : <th key={c} className={colClass(c)}>{c}</th>;
              })}
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
                <td>{r.call_type === "inbound" ? "Inbound" : "Outbound"}</td>
                <td>{hl(r.call_type === "inbound" ? r.from_number : r.to_number, terms)}</td>
                <td>{hl(r.owner_name, terms)}</td>
                <td>{hl(r.db_area, terms)}</td>
                <td className={cfClass(r.availability)}>
                  {r.availability ?? ""}
                  {r.needs_review && <span className="review-tag">review</span>}
                </td>
                <td>{r.built_up_area_sqft || ""}</td>
                <td>{r.expected_rent || ""}</td>
                <td className="call-toggle">{r.status}</td>
                <td className="call-col clip" title={r.notes ?? ""}>{hl(r.notes, terms)}</td>
                <td className="call-col clip" title={r.transcript ?? ""}>{hl(r.transcript, terms)}</td>
                <td className="call-col">{r.recording_url ? <a href={r.recording_url} target="_blank" rel="noreferrer">Play</a> : ""}</td>
                <td className="db-toggle clip" title={r.raw_sources ?? ""}>
                  {r.raw_sources ? hl(`[${r.raw_sources.split(", ").join(", ")}]`, terms) : ""}
                </td>
                <td className="db-col" title={r.raw_match_count > 1 ? matchesTooltip(r.raw_matches) : undefined}>
                  {hl(r.raw_owner_name, terms)}
                  {r.raw_contact_type === "probable broker" && <span className="review-tag">broker</span>}
                  {r.raw_match_count > 1 && <span className="review-tag">+{r.raw_match_count - 1}</span>}
                </td>
                <td className="db-col">{hl(r.raw_warehouse_type, terms)}</td>
                <td className="db-col">{hl(r.raw_city, terms)}</td>
                <td className="db-col">{hl(r.raw_state, terms)}</td>
                <td className="db-col">{r.raw_area_sqft ?? ""}</td>
                <td className="db-col clip" title={r.raw_sources ?? ""}>{hl(r.raw_sources, terms)}</td>
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
      <ColumnResize />
    </>
  );
}

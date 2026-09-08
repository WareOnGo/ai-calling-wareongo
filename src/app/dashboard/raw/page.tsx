import { RAW_COLUMNS as COLUMNS, RAW_GROUPS as GROUPS } from "../sheet-columns";
import { dateTime as fmtDate } from "@/lib/display";
import { SelectionProvider, SelectionSummary } from "../Selection";
import { ExportButton } from "../ExportButton";
import { FilterForm } from "../FilterForm";
import { Freshness } from "../DashboardUI";
import { RecordDetails } from "../RecordDetails";
import Link from "next/link";
import { getRawRecords, getRawFilterOptions, getQueuedNumberSet, type RawFilters, type RawRow } from "@/lib/raw";
import { requireAdmin } from "@/lib/auth";
import { listAssignees } from "@/lib/users";
import { AssignButton } from "../AssignButton";
import { GridInteractivity } from "../GridInteractivity";
import { ApplyButton } from "../ApplyButton";
import { ColumnResize } from "../ColumnResize";
import { GroupToggle } from "../GroupToggle";
import { IconDataset } from "../icons";
import { FiltersToggle } from "../FiltersToggle";
import { QueueForCalling } from "../QueueForCalling";
import { BatchActivity } from "../BatchActivity";
import { CopyText } from "../CopyText";
import { deriveCat, normNum } from "@/lib/queue";

export const dynamic = "force-dynamic";

// Admin-only page: this is the full scraped corpus with owner PII, and it's the
// launch point for Bolna dispatch. Employees see their assigned slice at
// /dashboard/my instead.


// Collapsible "Calls" group: green toggle shows the call count; collapses the
// call-history detail columns. Same pattern as the analytics view.

function colClass(label: string): string | undefined {
  for (const g of GROUPS) {
    if (label === g.toggle) return `${g.key}-toggle grp-toggle`;
    if (g.members.includes(label)) return `${g.key}-col`;
  }
  return undefined;
}



// Full call history for the hover tooltip on the Calls cell (one call per line).
function callsTooltip(history: RawRow["calls_history"]): string {
  if (!history || history.length === 0) return "";
  return history
    .map((h) => `${fmtDate(h.at)} · ${h.status ?? "?"}${h.availability ? ` · ${h.availability}` : ""}`)
    .join("\n");
}

function hl(text: string | null | undefined, terms: string[]): React.ReactNode {
  const s = text ?? "";
  if (!s || terms.length === 0) return s;
  const esc = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).filter(Boolean);
  if (esc.length === 0) return s;
  const parts = s.split(new RegExp(`(${esc.join("|")})`, "ig"));
  const isMatch = (p: string) => esc.some((e) => new RegExp(`^${e}$`, "i").test(p));
  return parts.map((p, i) => (isMatch(p) ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>));
}

type SP = Record<string, string | undefined>;

function qs(base: SP, override: SP) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...override })) if (v) p.set(k, v);
  return `?${p.toString()}`;
}

export default async function RawDataset({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAdmin();
  const rawSp = await searchParams;
  const sp: SP = {};
  for (const [k, v] of Object.entries(rawSp)) sp[k] = Array.isArray(v) ? v[0] : v;

  const filters: RawFilters = {
    q: sp.q,
    source: sp.source,
    state: sp.state,
    city: sp.city,
    contact: sp.contact,
    called: sp.called,
    last_result: sp.last_result,
    min_area: sp.min_area ? Number(sp.min_area) : undefined,
    max_area: sp.max_area ? Number(sp.max_area) : undefined,
    has_phone: sp.has_phone === "1",
    assignee: sp.assignee,
    page: sp.page ? Number(sp.page) : 1,
  };

  const [{ rows, total, page, pages, pageSize, terms }, opts, queuedSet, assignees] = await Promise.all([
    getRawRecords(user, filters),
    getRawFilterOptions(),
    getQueuedNumberSet(),
    listAssignees(),
  ]);

  const numCols = COLUMNS.length + 1; // + select col (group toggles count as one col each)
  const startRow = (page - 1) * pageSize;
  const activeFilters = ["source", "state", "city", "contact", "called", "last_result", "min_area", "max_area", "has_phone", "assignee"]
    .filter((k) => sp[k]).length;

  return (
    <SelectionProvider key={JSON.stringify(sp)} total={total}>
      <div className="page-title"><span className="pt-icon"><IconDataset size={18} /></span> Raw Dataset <BatchActivity /> <Freshness updatedAt={new Date().toISOString()} /></div>
      <FilterForm key={JSON.stringify(sp)} applied={sp} action="/dashboard/raw">
        <div className="search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input name="q" defaultValue={sp.q ?? ""} aria-label="Search records" placeholder="Search records…" title="Search owner, phone, city, source or address" />
        </div>

        <FiltersToggle count={activeFilters} />
        <ApplyButton />

        <ColumnResize />
        <span className="spacer" />
        <ExportButton entity="raw" />
        <AssignButton entity="record" total={total} assignees={assignees} />
        <QueueForCalling />
        <a className="btn-text" href="/dashboard/raw">Reset</a>

        <div className="filters-panel" id="filters-panel">
            <div className={`chip${sp.source ? " active" : ""}`}>
              <select aria-label="source" name="source" defaultValue={sp.source ?? ""}>
                <option value="">Source</option>
                {opts.sources.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div className={`chip${sp.state ? " active" : ""}`}>
              <select aria-label="state" name="state" defaultValue={sp.state ?? ""}>
                <option value="">State</option>
                {opts.states.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <label className="chip"><span className="sr-only">City</span><input name="city" aria-label="City" placeholder="City" defaultValue={sp.city ?? ""} /></label>
            <div className={`chip${sp.contact ? " active" : ""}`}>
              <select aria-label="contact" name="contact" defaultValue={sp.contact ?? ""}>
                <option value="">Contact</option>
                <option value="owner">Owner</option>
                <option value="broker">Probable broker</option>
              </select>
            </div>
            <div className={`chip${sp.called ? " active" : ""}`}>
              <select aria-label="called" name="called" defaultValue={sp.called ?? ""}>
                <option value="">Called?</option>
                <option value="no">Not called</option>
                <option value="yes">Already called</option>
              </select>
            </div>
            <div className={`chip${sp.last_result ? " active" : ""}`}>
              <select aria-label="last result" name="last_result" defaultValue={sp.last_result ?? ""}>
                <option value="">Last result</option>
                <option value="Available">Available</option>
                <option value="Unavailable">Unavailable</option>
                <option value="Unclear">Unclear</option>
              </select>
            </div>
            <input className="num-filter" type="number" aria-label="Minimum square feet" min="0" name="min_area" defaultValue={sp.min_area ?? ""} placeholder="min sqft" />
            <input className="num-filter" type="number" aria-label="Maximum square feet" min="0" name="max_area" defaultValue={sp.max_area ?? ""} placeholder="max sqft" />
            <label className={`toggle${sp.has_phone === "1" ? " active" : ""}`}>
              <input type="checkbox" name="has_phone" value="1" defaultChecked={sp.has_phone === "1"} />
              Has phone
            </label>
            <div className={`chip${sp.assignee ? " active" : ""}`}>
              <select aria-label="assignee" name="assignee" defaultValue={sp.assignee ?? ""}>
                <option value="">Assigned to</option>
                <option value="none">Unassigned</option>
                {assignees.map((a) => (
                  <option key={a.email} value={a.email}>{a.name || a.email}</option>
                ))}
              </select>
            </div>
        </div>
      </FilterForm>

      <SelectionSummary />
      <div className="gridwrap">
        <table className="sheet calls-collapsed">
          <thead>
            <tr className="colheads">
              <th className="rowgutter"></th>
              <th className="selcol"><input type="checkbox" className="selall" aria-label="Select all on this page" title="Select all on this page" /></th>
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
                  {activeFilters || sp.q ? <>No records match these filters. <Link href="/dashboard/raw">Clear filters</Link></> : "No records are available yet. Refresh after the dataset has been imported."}
                </td>
              </tr>
            )}
            {rows.map((r: RawRow, i) => (
              <tr key={r.id}>
                <td className="rownum">{startRow + i + 1}</td>
                <td className="selcol">
                  <input
                    type="checkbox"
                    className="rowsel"
                    aria-label={`Select ${r.owner_name || "record"}`}
                    disabled={!r.phone}
                    title={r.phone ? undefined : "No phone number on this record"}
                    data-id={r.id}
                    data-name={r.owner_first_name ?? r.owner_name ?? ""}
                    data-contact={r.phone ?? ""}
                    data-area={r.city ?? ""}
                    data-state={r.state ?? ""}
                    data-cat={deriveCat(r.call_count, r.last_availability)}
                    data-queued={r.phone && queuedSet.has(normNum(r.phone)) ? "1" : ""}
                  />
                </td>
                <td className="identity-owner">{hl(r.owner_name, terms)} <RecordDetails id={r.id} entity="record" /></td>
                <td><CopyText value={r.phone} display={hl(r.phone, terms)} label="phone number" /></td>
                <td>{r.area_sqft ? Number(r.area_sqft).toLocaleString("en-IN") : ""}</td>
                <td>{hl(r.source, terms)}</td>
                <td className="clip" title={r.source_record_id ?? ""}>{r.source_record_id ?? ""}</td>
                {/* Calls group (collapsible, middle) */}
                <td className="calls-toggle" title={r.call_count > 1 ? callsTooltip(r.calls_history) : undefined}>
                  {r.call_count > 0 ? r.call_count : "—"}
                </td>
                <td className="calls-col">{r.last_status ?? ""}</td>
                <td className="calls-col">{r.last_availability ?? ""}</td>
                <td className="calls-col">{fmtDate(r.last_called_at)}</td>
                <td className="calls-col clip" title={r.last_transcript ?? ""}>{r.last_transcript ?? ""}</td>
                <td className="calls-col">{r.last_recording_url ? <a href={r.last_recording_url} target="_blank" rel="noreferrer">Play</a> : ""}</td>
                <td className="calls-col clip" title={r.last_notes ?? ""}>{r.last_notes ?? ""}</td>
                {/* location kept together */}
                <td>{r.contact_type === "probable broker" ? <span className="review-tag">probable broker</span> : "owner"}</td>
                <td>{hl(r.city, terms)}</td>
                <td>{hl(r.state, terms)}</td>
                <td className="clip" title={r.address ?? ""}>{hl(r.address, terms)}</td>
                <td className="clip" title={r.assignment_note ?? ""}>
                  {r.assigned_to ?? <span className="muted">—</span>}
                  {r.assignment_state === "done" && <span className="review-tag">done</span>}
                </td>
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
          {page <= 1 ? <button type="button" disabled aria-label="First">«</button> : <Link href={qs(sp, { page: "1" })} aria-label="First">«</Link>}
          {page <= 1 ? <button type="button" disabled aria-label="Prev">‹</button> : <Link href={qs(sp, { page: String(page - 1) })} aria-label="Prev">‹</Link>}
          <span className="cur">{page}</span>
          {page >= pages ? <button type="button" disabled aria-label="Next">›</button> : <Link href={qs(sp, { page: String(page + 1) })} aria-label="Next">›</Link>}
          {page >= pages ? <button type="button" disabled aria-label="Last">»</button> : <Link href={qs(sp, { page: String(pages) })} aria-label="Last">»</Link>}
          <span className="muted">{page}/{pages}</span>
        </div>
      </div>

      <GridInteractivity />
    </SelectionProvider>
  );
}

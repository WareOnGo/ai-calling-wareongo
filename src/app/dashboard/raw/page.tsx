import {dispositionLabel} from "@/lib/manual-dispositions";
import {InlineAiTimeline} from '../AiTimeline';
import { firstValue, searchQuery, type SearchValues } from "@/lib/filter-values";
import { MultiSelect } from "../MultiSelect";
import { PageJump } from "../PageJump";
import { WalletBalance } from "../WalletBalance";
import { rawFiltersSchema } from "@/lib/filters";
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
import { getConfiguredLanguages } from "@/lib/agents";
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



function hl(text: string | null | undefined, terms: string[]): React.ReactNode {
  const s = text ?? "";
  if (!s || terms.length === 0) return s;
  const esc = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).filter(Boolean);
  if (esc.length === 0) return s;
  const parts = s.split(new RegExp(`(${esc.join("|")})`, "ig"));
  const isMatch = (p: string) => esc.some((e) => new RegExp(`^${e}$`, "i").test(p));
  return parts.map((p, i) => (isMatch(p) ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>));
}

type SP = SearchValues;
function qs(base: SP, override: SP) { return `?${searchQuery({ ...base, ...override })}`; }

export default async function RawDataset({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAdmin();
  const sp = await searchParams;

  const parsedFilters = rawFiltersSchema.safeParse(sp);
  if (!parsedFilters.success) return <p role="alert">Invalid filters. {parsedFilters.error.issues.map(i => i.message).join("; ")} <Link href="/dashboard/raw">Clear filters</Link></p>;
  const filters: RawFilters = { ...parsedFilters.data, page: Number(firstValue(sp.page) || 1) };


  const [{ rows, total, page, pages, pageSize, terms }, opts, queuedSet, assignees] = await Promise.all([
    getRawRecords(user, filters),
    getRawFilterOptions(),
    getQueuedNumberSet(),
    listAssignees(),
  ]);

  const numCols = COLUMNS.length + 1; // + select col (group toggles count as one col each)
  const startRow = (page - 1) * pageSize;
  const activeFilters = ["source", "state", "city", "contact", "called", "last_result", "min_area", "max_area", "has_phone", "assignee", "assignment_state", "manual_outcome", "onboarded", "warehouse_type"]
    .filter((k) => sp[k]).length;

  return (
    <SelectionProvider key={JSON.stringify(sp)} total={total}>
      <div className="page-title"><span className="pt-icon"><IconDataset size={18} /></span> Raw Dataset <BatchActivity /> <Freshness updatedAt={new Date().toISOString()} /></div>
      <WalletBalance/>
      <FilterForm key={JSON.stringify(sp)} applied={sp} action="/dashboard/raw">
        <div className="search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input name="q" defaultValue={firstValue(sp.q) || ""} aria-label="Search records" placeholder="Search records…" title="Search owner, phone, city, source or address" />
        </div>

        <FiltersToggle count={activeFilters} />
        <ApplyButton />

        <ColumnResize />
        <span className="spacer" />
        <ExportButton entity="raw" />
        <AssignButton entity="record" total={total} assignees={assignees} />
        <QueueForCalling availableLanguages={getConfiguredLanguages()} />
        <a className="btn-text" href="/dashboard/raw">Reset</a>

        <div className="filters-panel" id="filters-panel">
            <MultiSelect name="last_result" label="Last result" value={sp.last_result} options={["Available","Unavailable","Unclear",{value:"none",label:"No AI result"}]}/>
            <MultiSelect name="source" label="Source" value={sp.source} options={opts.sources}/>
            <MultiSelect name="state" label="State" value={sp.state} options={opts.states}/>
            <label className="chip"><span className="sr-only">City</span><input name="city" aria-label="City" placeholder="City" defaultValue={firstValue(sp.city) || ""}/></label>
            <MultiSelect name="contact" label="Contact" value={sp.contact} options={[{value:"owner",label:"Owner"},{value:"broker",label:"Probable broker"}]}/>
            <MultiSelect name="manual_outcome" label="Manual result" value={sp.manual_outcome} options={["Available","Unavailable","Unclear",{value:"none",label:"No manual result"}]}/>
            <input className="num-filter" type="number" aria-label="Minimum square feet" min="0" name="min_area" defaultValue={firstValue(sp.min_area)||""} placeholder="min sqft"/>
            <input className="num-filter" type="number" aria-label="Maximum square feet" min="0" name="max_area" defaultValue={firstValue(sp.max_area)||""} placeholder="max sqft"/>
            <div className="chip"><select name="onboarded" aria-label="Onboarded" defaultValue={firstValue(sp.onboarded)||""}><option value="">Any onboarding</option><option value="yes">Onboarded with WH ID</option><option value="no">Not onboarded</option></select></div>
            <div className="chip"><select name="assignment_state" aria-label="Ownership" defaultValue={firstValue(sp.assignment_state)||""}><option value="">Any ownership</option><option value="unassigned">Unassigned — excludes completed</option><option value="open">Open assignment</option><option value="done">Completed history</option><option value="never">Never assigned</option></select></div>
            <MultiSelect name="warehouse_type" label="Warehouse type" value={sp.warehouse_type} options={opts.warehouseTypes}/>
            <div className="chip"><select aria-label="Called" name="called" defaultValue={firstValue(sp.called)||""}><option value="">Called?</option><option value="no">Not called</option><option value="yes">Already called</option></select></div>
            <label className="toggle"><input type="checkbox" name="has_phone" value="1" defaultChecked={sp.has_phone==="1"}/>Has phone</label>
            <MultiSelect name="assignee" label="Assigned to" value={sp.assignee} options={[{value:"none",label:"Unassigned — excludes completed"},...assignees.map(a=>({value:a.email,label:a.name||a.email}))]}/>
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
                  : <th key={c} data-column={c} className={colClass(c)}>{c}</th>;
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
                <td className="calls-toggle" title="Open AI timeline for attempt history">
                  {r.ai_attempt_count||0} outbound · {r.ai_inbound_count||0} inbound<small><br/>{r.call_count} execution records</small><br/><InlineAiTimeline entity="record" id={r.id}/>
                </td>
                <td className="calls-col">{r.last_status ?? ""}</td>
                <td className="calls-col">{r.last_availability ?? ""}</td>
                <td className="calls-col">{fmtDate(r.last_called_at)}</td>
                <td className="calls-col clip" title="Transcript preview; open Details for the full transcript">{r.last_transcript ?? ""}</td>
                <td className="calls-col">{r.last_recording_url ? <a href={r.last_recording_url} target="_blank" rel="noreferrer">Play</a> : ""}</td>
                <td className="calls-col clip" title={r.last_notes ?? ""}>{r.last_notes ?? ""}</td>
                <td><RecordDetails id={r.id} entity="record" label="Manual calls"/><br/>{r.manual_attempt_count||0} recorded in {r.assignment_state==='open'?'current':'latest'} assignment<br/>{r.assignment_outcome||"No manual result"}{r.manual_disposition&&<><br/>{dispositionLabel(r.manual_disposition)}</>}{r.assignment_closure_reason==='exhausted'&&<><br/>Closed: Exhausted</>}{r.manual_last_attempt_at&&<><br/>{fmtDate(r.manual_last_attempt_at)}</>}{r.manual_next_due_at&&<><br/>Due {fmtDate(r.manual_next_due_at)}</>}</td>
                {/* location kept together */}
                <td>{r.contact_type === "probable broker" ? <span className="review-tag">probable broker</span> : "owner"}</td>
                <td>{hl(r.city, terms)}</td>
                <td>{hl(r.state, terms)}</td>
                <td className="clip" title={r.address ?? ""}>{hl(r.address, terms)}</td>
                <td className="clip" title={r.assignment_note ?? ""}>
                  {r.assigned_to ?? <span className="muted">—</span>}
                  {!r.assigned_to && r.assignment_state === "done" && <span className="review-tag" title={`Previously assigned to ${r.assignment_assignee || "a caller"}; see Details`}>completed history</span>}
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

      <PageJump key={page} page={page} pages={pages}/>

      <GridInteractivity />
    </SelectionProvider>
  );
}

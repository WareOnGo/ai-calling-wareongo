import {dispositionLabel} from "@/lib/manual-dispositions";
import {AiHistoryButton} from '../AiTimeline';
import { firstValue } from "@/lib/filter-values";
import { MultiSelect } from "../MultiSelect";
import { RecordsPagination } from "../RecordsPagination";
import { RecordsHeader } from "../RecordsHeader";
import { WalletBalance } from "../WalletBalance";
import { rawFiltersSchema } from "@/lib/filters";
import { RAW_COLUMNS as COLUMNS } from "../sheet-columns";
import { dateTime as fmtDate } from "@/lib/display";
import { ResultBadge } from "../ResultBadge";
import { AssignedCaller } from "../AssignedCaller";
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
import { ApplyButton } from "../ApplyButton";
import { ColumnChooser } from "../ColumnChooser";
import { IconDataset } from "../icons";
import { FilterPanel } from "../FilterPanel";
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


function hl(text: string | null | undefined, terms: string[]): React.ReactNode {
  const s = text ?? "";
  if (!s || terms.length === 0) return s;
  const esc = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).filter(Boolean);
  if (esc.length === 0) return s;
  const parts = s.split(new RegExp(`(${esc.join("|")})`, "ig"));
  const isMatch = (p: string) => esc.some((e) => new RegExp(`^${e}$`, "i").test(p));
  return parts.map((p, i) => (isMatch(p) ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>));
}

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

  const numCols = COLUMNS.length + 1; // + selection column
  const startRow = (page - 1) * pageSize;
  const activeFilters = ["source", "state", "city", "contact", "called", "last_result", "min_area", "max_area", "has_phone", "assignee", "assignment_state", "manual_outcome", "onboarded", "warehouse_type"]
    .filter((k) => sp[k]).length;

  return (
    <SelectionProvider key={JSON.stringify(sp)} total={total}>
      <RecordsHeader title="Raw Dataset" icon={<IconDataset size={18}/>} meta={<WalletBalance compact/>} actions={<><BatchActivity/><Freshness updatedAt={new Date().toISOString()}/></>}/>
      <FilterForm key={JSON.stringify(sp)} applied={sp} action="/dashboard/raw" viewTools={<ColumnChooser/>} actions={<><ExportButton entity="raw"/><AssignButton entity="record" total={total} assignees={assignees}/><QueueForCalling availableLanguages={getConfiguredLanguages()}/></>}>
        <div className="search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input name="q" defaultValue={firstValue(sp.q) || ""} aria-label="Search records" placeholder="Search records…" title="Search owner, phone, city, source or address" />
        </div>

        <FiltersToggle count={activeFilters} />
        <ApplyButton />

        <a className="btn-text toolbar-reset" href="/dashboard/raw">Reset</a>

        <FilterPanel groups={[
          { label: "Call outcome", count: ["last_result", "manual_outcome", "called"].filter(key => sp[key]).length, content: <>
            <MultiSelect name="last_result" label="Last result" value={sp.last_result} options={["Available","Unavailable","Unclear",{value:"none",label:"No AI result"}]}/>
            <MultiSelect name="manual_outcome" label="Manual result" value={sp.manual_outcome} options={["Available","Unavailable","Unclear",{value:"none",label:"No manual result"}]}/>
            <label className="chip filter-field"><span>Called</span><select aria-label="Called" name="called" defaultValue={firstValue(sp.called)||""}><option value="">Called?</option><option value="no">Not called</option><option value="yes">Already called</option></select></label>
          </> },
          { label: "Property", count: ["city", "state", "source", "contact", "warehouse_type", "min_area", "max_area", "has_phone"].filter(key => sp[key]).length, content: <>
            <label className="chip"><span>City</span><input name="city" aria-label="City" placeholder="City" defaultValue={firstValue(sp.city) || ""}/></label>
            <MultiSelect name="state" label="State" value={sp.state} options={opts.states}/>
            <MultiSelect name="source" label="Source" value={sp.source} options={opts.sources}/>
            <MultiSelect name="contact" label="Contact" value={sp.contact} options={[{value:"owner",label:"Owner"},{value:"broker",label:"Probable broker"}]}/>
            <MultiSelect name="warehouse_type" label="Warehouse type" value={sp.warehouse_type} options={opts.warehouseTypes}/>
            <label className="filter-field"><span>Minimum square feet</span><input className="num-filter" type="number" aria-label="Minimum square feet" min="0" name="min_area" defaultValue={firstValue(sp.min_area)||""} placeholder="min sqft"/></label>
            <label className="filter-field"><span>Maximum square feet</span><input className="num-filter" type="number" aria-label="Maximum square feet" min="0" name="max_area" defaultValue={firstValue(sp.max_area)||""} placeholder="max sqft"/></label>
            <label className="toggle"><input type="checkbox" name="has_phone" value="1" defaultChecked={sp.has_phone==="1"}/>Has phone</label>
          </> },
          { label: "Assignment", count: ["assignee", "assignment_state", "onboarded"].filter(key => sp[key]).length, content: <>
            <MultiSelect name="assignee" label="Assigned to" value={sp.assignee} options={[{value:"none",label:"Unassigned now"},...assignees.map(a=>({value:a.email,label:a.name||a.email}))]}/>
            <label className="chip filter-field"><span>Ownership</span><select name="assignment_state" aria-label="Ownership" defaultValue={firstValue(sp.assignment_state)||""}><option value="">Any ownership</option><option value="unassigned">Unassigned now</option><option value="open">Open assignment</option><option value="done">Completed history</option><option value="never">Never assigned</option></select></label>
            <label className="chip filter-field"><span>Onboarded</span><select name="onboarded" aria-label="Onboarded" defaultValue={firstValue(sp.onboarded)||""}><option value="">Any onboarding</option><option value="yes">Onboarded with WH ID</option><option value="no">Not onboarded</option></select></label>
          </> },
        ]} />
      </FilterForm>

      <SelectionSummary />
      <div className="gridwrap">
        <table className="sheet">
          <thead>
            <tr className="colheads">
              <th className="rowgutter"></th>
              <th className="selcol"><input type="checkbox" className="selall" aria-label="Select all on this page" title="Select all on this page" /></th>
              {COLUMNS.map(c => <th key={c} data-column={c}>{c}</th>)}
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
                <td>{r.contact_type === "probable broker" ? <span className="review-tag">probable broker</span> : "owner"}</td>
                <td>{hl(r.city, terms)}</td>
                <td>{hl(r.state, terms)}</td>
                <td className="clip" title={r.address ?? ""}><span className="record-preview">{hl(r.address, terms)}</span></td>
                <td className="numeric-cell">{r.area_sqft ? Number(r.area_sqft).toLocaleString("en-IN") : ""}</td>
                <td>{hl(r.source, terms)}</td>
                <td className="clip" title={r.source_record_id ?? ""}>{r.source_record_id ?? ""}</td>
                {/* AI execution history */}
                <td className="record-history">
                  {(r.ai_attempt_count||0)+(r.ai_inbound_count||0)>0
                    ? <AiHistoryButton entity="record" id={r.id} name={r.owner_name} executionCount={r.call_count} summary={{outbound:r.ai_attempt_count||0,inbound:r.ai_inbound_count||0,result:r.ai_history_result}}/>
                    : <span className="muted">0 outbound · 0 inbound</span>}
                  <small className="sr-only"> · {r.call_count} execution records</small>
                </td>
                <td className="calls-col">{r.last_status ?? ""}</td>
                <td className="calls-col"><ResultBadge value={r.last_availability} empty="No AI result"/></td>
                <td className="calls-col">{fmtDate(r.last_called_at)}</td>
                <td className="calls-col clip" title="Transcript preview; open Details for the full transcript"><span className="record-preview">{r.last_transcript ?? ""}</span></td>
                <td className="calls-col">{r.last_recording_url ? <a href={r.last_recording_url} target="_blank" rel="noreferrer">Play</a> : ""}</td>
                <td className="calls-col clip" title={r.last_notes ?? ""}><span className="record-preview">{r.last_notes ?? ""}</span></td>
                <td className="clip" title={r.assignment_note ?? ""}>
                  <AssignedCaller current={r.assigned_to} previous={r.assignment_assignee} state={r.assignment_state} people={assignees}/>
                </td>
                <td className="record-history"><div><ResultBadge value={r.assignment_outcome} empty="No manual result"/></div>{(r.manual_attempt_count||0)>0&&<RecordDetails id={r.id} entity="record" label="Manual calls"/>}<div className="sr-only">{r.manual_attempt_count||0} recorded in {r.assignment_state==='open'?'current':'latest'} assignment<br/>{r.assignment_outcome||"No manual result"}{r.manual_disposition&&<><br/>{dispositionLabel(r.manual_disposition)}</>}{r.assignment_closure_reason==='exhausted'&&<><br/>Closed: Exhausted</>}{r.manual_last_attempt_at&&<><br/>{fmtDate(r.manual_last_attempt_at)}</>}{r.manual_next_due_at&&<><br/>Due {fmtDate(r.manual_next_due_at)}</>}</div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <RecordsPagination page={page} pages={pages} total={total} pageSize={pageSize} applied={sp}/>

    </SelectionProvider>
  );
}

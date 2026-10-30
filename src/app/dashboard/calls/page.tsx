import { WarehouseReference } from "../WarehouseNotice";
import { AiActivityFilter, ReportingFilters, REPORTING_FILTER_KEYS, SelectFilter, YesNoFilter, DateFilters } from "../FilterFields";
import {AiAttemptCard} from '../AiAttemptCard';
import { firstValue } from "@/lib/filter-values";
import { MultiSelect } from "../MultiSelect";
import { RecordsPagination } from "../RecordsPagination";
import { RecordsHeader } from "../RecordsHeader";
import { AiReviewNotice } from "../GridNotices";
import { callFiltersSchema } from "@/lib/filters";
import { callColumns } from "../sheet-columns";
import { dateTime as fmtDate, rent, number } from "@/lib/display";
import { ResultBadge } from "../ResultBadge";
import { AssignedCaller } from "../AssignedCaller";
import { SelectionProvider, SelectionSummary } from "../Selection";
import { ExportButton } from "../ExportButton";
import { FilterForm } from "../FilterForm";
import { Freshness } from "../DashboardUI";
import { RecordDetails } from "../RecordDetails";
import Link from "next/link";
import { countCalls,getCalls, getFilterOptions, type CallFilters, type CallRow } from "@/lib/calls";
import { agentLabel } from "@/lib/agents";
import { requireUser } from "@/lib/auth";
import { listAssignees } from "@/lib/users";
import { AssignmentNotes } from "../assignments/AssignmentNotes";
import { EnrichButton } from "../EnrichButton";
import { ApplyButton } from "../ApplyButton";
import { ColumnChooser } from "../ColumnChooser";
import { IconPhone, IconDownload } from "../icons";
import { FilterPanel } from "../FilterPanel";
import { FiltersToggle } from "../FiltersToggle";
import { AssignButton } from "../AssignButton";
import { ContactCard } from "../ContactCard";

export const dynamic = "force-dynamic";

// One grid for both roles: the role changes what's RENDERED (assignment column,
// bulk-assign, assignee filter), the scope in lib/calls.ts changes what's FETCHED.
// Forking the page per role would mean fixing every grid bug twice.



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

function cfClass(availability: string | null) {
  const v = (availability ?? "").toLowerCase();
  if (v === "available") return "cf-green";
  if (v === "unavailable") return "cf-red";
  if (v.startsWith("dead")) return "cf-gray";
  return "cf-yel"; // Unclear
}



export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;

  const parsedFilters = callFiltersSchema.safeParse(sp);
  if (!parsedFilters.success) return <p role="alert">Invalid filters. {parsedFilters.error.issues.map(i => i.message).join("; ")} <Link href="/dashboard/calls">Clear filters</Link></p>;
  const filters: CallFilters = { ...parsedFilters.data, page: Number(firstValue(sp.page) || 1) };


  const [{ rows, total, page, pages, pageSize, terms }, opts, assignees,aiReviewCount] = await Promise.all([
    getCalls(user, filters),
    getFilterOptions(),
    listAssignees(),countCalls(user,{needs_review:true}),
  ]);

  // Admins get an owner column; employees are only ever looking at their own rows.
  const COLUMNS = callColumns(user.isAdmin);
  const numCols = COLUMNS.length + (user.isAdmin ? 1 : 0); // + selection column
  const startRow = (page - 1) * pageSize;

  // active filter count (everything except free-text search) for the Filters badge
  const activeFilters = ["availability", "call_type", "source", "state", "contact", "agent_id", "status", "date_from", "date_to", "needs_review", "assignee", "assignment_state", "manual_outcome", "rent_mentioned", "onboarded", "warehouse_type", "min_area", "max_area", "city", "area_basis", "include_blocked", "batch_id", "has_recording", "has_transcript", "has_ai_calls", "has_listing", ...REPORTING_FILTER_KEYS]
    .filter((k) => sp[k]).length;

  return (
    <SelectionProvider key={JSON.stringify(sp)} total={total}>
      <RecordsHeader title="AI Calls" icon={<IconPhone size={18}/>} meta={<AiReviewNotice count={aiReviewCount}/>} actions={<Freshness updatedAt={new Date().toISOString()}/>}/>
      {/* Search and optional filters */}
      <FilterForm key={JSON.stringify(sp)} applied={sp} action="/dashboard/calls" viewTools={<ColumnChooser/>} actions={<><ExportButton entity="calls"/>{user.isAdmin&&<AssignButton entity="call" total={total} assignees={assignees}/>}</>}>
        <div className="search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input name="q" defaultValue={firstValue(sp.q) || ""} aria-label="Search calls" placeholder="Search calls…" title="Search phone, owner, source, state or transcript" />
        </div>

        <FiltersToggle count={activeFilters} />
        <ApplyButton />

        <a className="btn-text toolbar-reset" href="/dashboard/calls">Reset</a>

        <FilterPanel groups={[
          { label: "Call outcome", count: ["availability", "manual_outcome", "status", "needs_review"].filter(key => sp[key]).length, content: <>
            <MultiSelect name="availability" label="AI result" value={sp.availability} options={[...opts.availabilities,{value:"none",label:"No AI result"}]}/>
            <MultiSelect name="manual_outcome" label="Manual result" value={sp.manual_outcome} options={["Available","Unavailable","Unclear",{value:"none",label:"No manual result"}]}/>
            <MultiSelect name="status" label="Status" value={sp.status} options={opts.statuses}/>
            <SelectFilter name="needs_review" label="AI review" applied={{...sp,needs_review:filters.needs_review===undefined?undefined:filters.needs_review?"1":"0"}} options={[{value:"1",label:"Needs AI review"},{value:"0",label:"Does not need review"}]}/>
          </> },
          { label: "Property", count: ["city", "state", "source", "contact", "min_area", "max_area", "area_basis", "rent_mentioned", "warehouse_type", "has_listing"].filter(key => sp[key]).length, content: <>
            <label className="chip"><span>City</span><input name="city" aria-label="City" placeholder="City" defaultValue={firstValue(sp.city) || ""}/></label>
            <MultiSelect name="state" label="State" value={sp.state} options={opts.states}/>
            <MultiSelect name="source" label="Source" value={sp.source} options={opts.sources}/>
            <MultiSelect name="warehouse_type" label="Warehouse type" value={sp.warehouse_type} options={opts.warehouseTypes}/>
            <YesNoFilter name="has_listing" label="Source listing match" applied={sp} yes="Matched to Raw Dataset" no="No matching listing"/>
            <MultiSelect name="contact" label="Contact type" value={sp.contact} options={[{value:"owner",label:"Owner"},{value:"broker",label:"Probable broker"}]}/>
            <label className="filter-field"><span>Minimum square feet</span><input className="num-filter" type="number" aria-label="Minimum square feet" min="0" name="min_area" defaultValue={firstValue(sp.min_area)||""} placeholder="min sqft"/></label>
            <label className="filter-field"><span>Maximum square feet</span><input className="num-filter" type="number" aria-label="Maximum square feet" min="0" name="max_area" defaultValue={firstValue(sp.max_area)||""} placeholder="max sqft"/></label>
            <label className="chip filter-field"><span>Square feet basis</span><select name="area_basis" aria-label="Square feet basis" defaultValue={firstValue(sp.area_basis)||""}><option value="">Source sqft</option><option value="built_up">AI built-up sqft</option><option value="carpet">AI carpet sqft</option></select></label>
            <label className="chip filter-field"><span>Rent mentioned</span><select name="rent_mentioned" aria-label="Rent mentioned" defaultValue={firstValue(sp.rent_mentioned)||""}><option value="">Any rent</option><option value="yes">Rent mentioned</option><option value="no">Rent missing / unknown</option></select></label>
          </> },
          { label: "Call details", count: ["call_type", "agent_id", "date_from", "date_to", "include_blocked", "has_recording", "has_transcript", "has_ai_calls", "batch_id"].filter(key => sp[key]).length, content: <>
            <MultiSelect name="call_type" label="Direction" value={sp.call_type} options={[{value:"inbound",label:"Inbound"},{value:"outbound",label:"Outbound"}]}/>
            <MultiSelect name="agent_id" label="Agent" value={sp.agent_id} options={opts.agents.map(v=>({value:v,label:agentLabel(v)}))}/>
            <AiActivityFilter applied={sp}/>
            <DateFilters applied={sp} label="Call date" />
            <label><span>Provider batch ID</span><input name="batch_id" defaultValue={firstValue(sp.batch_id)||""} placeholder="Exact provider batch ID"/></label>
            <YesNoFilter name="has_recording" label="Recording" applied={sp} yes="Has recording" no="No recording" />
            <YesNoFilter name="has_transcript" label="Transcript" applied={sp} yes="Has transcript" no="No transcript" />
            <label className="toggle"><input type="checkbox" name="include_blocked" value="1" defaultChecked={filters.include_blocked===true}/>Include balance-blocked executions</label>
          </> },
          { label: "Reporting", count: REPORTING_FILTER_KEYS.filter(key => sp[key]).length, content: <ReportingFilters applied={sp} /> },
          { label: "Assignment", count: ["assignee", "assignment_state", "onboarded"].filter(key => sp[key]).length, content: <>
            {user.isAdmin && <MultiSelect name="assignee" label="Assigned to" value={sp.assignee} options={[{value:"none",label:"Unassigned now"},...assignees.map(a=>({value:a.email,label:a.name||a.email}))]}/>}
            <label className="chip filter-field"><span>Ownership</span><select name="assignment_state" aria-label="Ownership" defaultValue={firstValue(sp.assignment_state)||""}><option value="">Any ownership</option><option value="unassigned">Unassigned now</option><option value="open">Open assignment</option><option value="done">Completed assignment</option><option value="never">Never assigned</option></select></label>
            <label className="chip filter-field"><span>Onboarded</span><select name="onboarded" aria-label="Onboarded" defaultValue={firstValue(sp.onboarded)||""}><option value="">Any onboarding</option><option value="yes">Onboarded with WH ID</option><option value="no">Not onboarded</option></select></label>
          </> },
        ]} />
      </FilterForm>

      {user.isAdmin && <SelectionSummary />}
      <div className="gridwrap">
        <table className="sheet">
          <thead>
            <tr className="colheads">
              <th className="rowgutter"></th>
              {user.isAdmin && (
                <th className="selcol"><input type="checkbox" className="selall" aria-label="Select all on this page" title="Select all on this page" /></th>
              )}
              {COLUMNS.map(c => <th key={c} data-column={c}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className="rownum"></td>
                <td colSpan={numCols} className="muted" style={{ textAlign: "center", padding: 24 }}>
                  {activeFilters || sp.q ? <>No calls match these filters. <Link href="/dashboard/calls">Clear filters</Link></> : user.isAdmin ? "No calls have arrived yet. Refresh to check for new results." : "No AI calls are assigned to you yet. Your admin can assign calls for follow-up."}
                </td>
              </tr>
            )}
            {rows.map((r: CallRow, i) => (
              <tr key={r.id}>
                <td className="rownum">{startRow + i + 1}</td>
                {user.isAdmin && (
                  <td className="selcol">
                    <input type="checkbox" className="rowsel" aria-label={`Select ${r.owner_name || r.to_number || "call"}`} data-id={r.id} />
                  </td>
                )}
                <td className="identity-owner"><ContactCard name={r.owner_name} nameDisplay={hl(r.owner_name, terms)}
                  phone={r.call_type === "inbound" ? r.from_number : r.to_number}
                  phoneDisplay={hl(r.call_type === "inbound" ? r.from_number : r.to_number, terms)}
                  details={{id: r.id, entity: "call"}}
                  metadata={<span title={[r.source_cities, fmtDate(r.call_created_at)].filter(Boolean).join(" · ")}>{r.source_cities && <>{hl(r.source_cities, terms)} · </>}{fmtDate(r.call_created_at)}</span>}
                /></td>
                <td>{fmtDate(r.call_created_at)}</td>
                <td>{r.call_type === "inbound" ? "Inbound" : "Outbound"}</td>
                <td title={r.agent_id || undefined}>{agentLabel(r.agent_id)}</td>
                <td className={cfClass(r.availability)}>
                  <ResultBadge value={r.availability} empty="No AI result" className="cell-status"/>
                  {r.needs_review && <span className="review-tag" title="The AI inference has low confidence; review the transcript or recording.">Needs AI review</span>}
                  {!r.inferred && r.can_enrich && <EnrichButton id={r.id} />}
                </td>
                <td className="record-history"><AiAttemptCard entity="call" id={r.id} summary={r.ai_summary}/></td>
                <td className="call-toggle">{r.status}</td>
                <td className="call-col clip" title={r.notes ?? ""}><span className="record-preview">{hl(r.notes, terms)}</span></td>
                <td className="call-col clip" title="Transcript preview; open Details for the full transcript"><span className="record-preview">{hl(r.transcript, terms)}</span></td>
                <td className="call-col">{r.recording_url ? <a href={r.recording_url} target="_blank" rel="noreferrer">Play</a> : ""}</td>
                {user.isAdmin && (
                  <td className="clip" title={r.assignment_note ?? ""}>
                    <AssignedCaller current={r.assigned_to} previous={r.assignment_assignee} state={r.assignment_state} people={assignees}/>
                  </td>
                )}
                <td><ResultBadge value={r.assignment_outcome} empty="No manual result"/>{r.assignment_closure_reason==='exhausted'&&<><br/>Closed: Exhausted</>}<br/><RecordDetails id={r.id} entity="call" label="Manual history" initialSection="Manual activity" title="Callyzer calls and staff logs for this contact"/></td>
                <td className="report-notes"><AssignmentNotes text={r.assignment_remarks}/></td>
                <td><span className={r.assignment_added_to_db ? undefined : "muted"}>{r.assignment_added_to_db ? "Yes" : "No"}</span></td>
                <td>
                  <WarehouseReference savedId={r.assignment_wh_id} ids={r.warehouse_ids}/>
                  {((r.wh_id && r.wh_id !== r.assignment_wh_id) || (r.added_to_db && !r.assignment_added_to_db)) && <small className="legacy-reference">Legacy call: {r.wh_id || "ID missing"}{r.added_to_db ? " · Added" : ""}</small>}
                </td>
                <td title="Legacy metadata; actual callers are recorded in manual history">{r.called_by || "—"}</td>
                <td>{r.source_cities ? hl(r.source_cities, terms) : <span className="muted">Unknown</span>}</td>
                <td>{hl(r.db_area, terms)}</td>
                <td className="numeric-cell">{number(r.built_up_area_sqft)}</td>
                <td className="numeric-cell">{number(r.carpet_area_sqft)}</td>
                <td className="numeric-cell">{rent(r.expected_rent)}</td>
                <td className="db-toggle clip" title={r.raw_sources ?? ""}>
                  {r.raw_sources ? hl(`[${r.raw_sources.split(", ").join(", ")}]`, terms) : ""}
                </td>
                <td className="db-col" title="Open Details for matched source listings">
                  {hl(r.raw_owner_name, terms)}
                  {r.raw_contact_type === "probable broker" && <span className="review-tag">probable broker</span>}
                  {r.raw_match_count > 1 && <span className="review-tag">+{r.raw_match_count - 1}</span>}
                </td>
                <td className="db-col">{hl(r.raw_warehouse_type, terms)}</td>
                <td className="db-col">{hl(r.raw_city, terms)}</td>
                <td className="db-col">{hl(r.raw_state, terms)}</td>
                <td className="db-col numeric-cell">{number(r.raw_area_sqft)}</td>
                <td className="db-col clip" title={r.raw_sources ?? ""}>{hl(r.raw_sources, terms)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <RecordsPagination page={page} pages={pages} total={total} pageSize={pageSize} applied={sp}/>


    </SelectionProvider>
  );
}

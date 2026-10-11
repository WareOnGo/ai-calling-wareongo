import {InlineAiTimeline} from '../AiTimeline';
import { firstValue, searchQuery, type SearchValues } from "@/lib/filter-values";
import { MultiSelect } from "../MultiSelect";
import { PageJump } from "../PageJump";
import { AiReviewNotice, CallGridHint } from "../GridNotices";
import { callFiltersSchema } from "@/lib/filters";
import { CALL_COLUMNS as BASE_COLUMNS, CALL_GROUPS as GROUPS } from "../sheet-columns";
import { dateTime as fmtDate, rent, number } from "@/lib/display";
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
import { GridInteractivity } from "../GridInteractivity";
import { EditableCells } from "../EditableCells";
import { EnrichButton } from "../EnrichButton";
import { ApplyButton } from "../ApplyButton";
import { GroupToggle } from "../GroupToggle";
import { ColumnResize } from "../ColumnResize";
import { IconPhone, IconDownload } from "../icons";
import { FiltersToggle } from "../FiltersToggle";
import { AssignButton } from "../AssignButton";
import { CopyText } from "../CopyText";

export const dynamic = "force-dynamic";

// One grid for both roles: the role changes what's RENDERED (assignment column,
// bulk-assign, assignee filter), the scope in lib/calls.ts changes what's FETCHED.
// Forking the page per role would mean fixing every grid bug twice.


// Collapsible column groups: a green toggle column (always shown, holds a summary
// value) that collapses/expands its detail columns.
//  - "AI Call Details": summary = Status; collapses Notes / Transcript / Recording
//  - "DB":              summary = Source; collapses the matched-listing detail columns

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

function cfClass(availability: string | null) {
  const v = (availability ?? "").toLowerCase();
  if (v === "available") return "cf-green";
  if (v === "unavailable") return "cf-red";
  if (v.startsWith("dead")) return "cf-gray";
  return "cf-yel"; // Unclear
}



type SP = SearchValues;
function qs(base: SP, override: SP) { return `?${searchQuery({ ...base, ...override })}`; }

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
  const COLUMNS = user.isAdmin ? [...BASE_COLUMNS, "Assigned To"] : BASE_COLUMNS;
  const numCols = COLUMNS.length + (user.isAdmin ? 1 : 0); // + selection column
  const startRow = (page - 1) * pageSize;

  // active filter count (everything except free-text search) for the Filters badge
  const activeFilters = ["availability", "call_type", "source", "state", "contact", "agent_id", "status", "date_from", "date_to", "needs_review", "assignee", "assignment_state", "manual_outcome", "rent_mentioned", "onboarded", "warehouse_type", "min_area", "max_area", "city"]
    .filter((k) => sp[k]).length;

  return (
    <SelectionProvider key={JSON.stringify(sp)} total={total}>
      <div className="page-title"><span className="pt-icon"><IconPhone size={18} /></span> Call Analytics <Freshness updatedAt={new Date().toISOString()} /></div>
      <AiReviewNotice count={aiReviewCount} />
      {/* Filters — Google-style chips */}
      <FilterForm key={JSON.stringify(sp)} applied={sp} action="/dashboard/calls">
        <div className="search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input name="q" defaultValue={firstValue(sp.q) || ""} aria-label="Search calls" placeholder="Search calls…" title="Search phone, owner, source, state or transcript" />
        </div>

        <FiltersToggle count={activeFilters} />
        <ApplyButton />

        <ColumnResize />
        <span className="spacer" />
        <ExportButton entity="calls" />
        {user.isAdmin && <AssignButton entity="call" total={total} assignees={assignees} />}
        <a className="btn-text" href="/dashboard/calls">Reset</a>

        <div className="filters-panel" id="filters-panel">
            {firstValue(sp.batch_id)&&<input type="hidden" name="batch_id" value={firstValue(sp.batch_id)}/>}
            <label className="toggle"><input type="checkbox" name="include_blocked" value="1" defaultChecked={sp.include_blocked==="1"}/>Include balance-blocked executions</label>
            <MultiSelect name="availability" label="AI result" value={sp.availability} options={[...opts.availabilities,{value:"none",label:"No AI result"}]}/>
            <MultiSelect name="call_type" label="Direction" value={sp.call_type} options={[{value:"inbound",label:"Inbound"},{value:"outbound",label:"Outbound"}]}/>
            <MultiSelect name="agent_id" label="Agent" value={sp.agent_id} options={opts.agents.map(v=>({value:v,label:agentLabel(v)}))}/>
            <MultiSelect name="status" label="Status" value={sp.status} options={opts.statuses}/>
            <label className="datefld"><span>From</span><input type="date" name="date_from" defaultValue={firstValue(sp.date_from)||""}/></label>
            <label className="datefld"><span>To</span><input type="date" name="date_to" defaultValue={firstValue(sp.date_to)||""}/></label>
            <MultiSelect name="source" label="Source" value={sp.source} options={opts.sources}/>
            <MultiSelect name="state" label="State" value={sp.state} options={opts.states}/>
            <label className="chip"><span className="sr-only">City</span><input name="city" aria-label="City" placeholder="City" defaultValue={firstValue(sp.city) || ""}/></label>
            <MultiSelect name="contact" label="Contact" value={sp.contact} options={[{value:"owner",label:"Owner"},{value:"broker",label:"Probable broker"}]}/>
            <MultiSelect name="manual_outcome" label="Manual result" value={sp.manual_outcome} options={["Available","Unavailable","Unclear",{value:"none",label:"No manual result"}]}/>
            <input className="num-filter" type="number" aria-label="Minimum square feet" min="0" name="min_area" defaultValue={firstValue(sp.min_area)||""} placeholder="min sqft"/>
            <input className="num-filter" type="number" aria-label="Maximum square feet" min="0" name="max_area" defaultValue={firstValue(sp.max_area)||""} placeholder="max sqft"/>
            <div className="chip"><select name="rent_mentioned" aria-label="Rent mentioned" defaultValue={firstValue(sp.rent_mentioned)||""}><option value="">Any rent</option><option value="yes">Rent mentioned</option><option value="no">Rent missing / unknown</option></select></div>
            <div className="chip"><select name="onboarded" aria-label="Onboarded" defaultValue={firstValue(sp.onboarded)||""}><option value="">Any onboarding</option><option value="yes">Onboarded with WH ID</option><option value="no">Not onboarded</option></select></div>
            <div className="chip"><select name="assignment_state" aria-label="Ownership" defaultValue={firstValue(sp.assignment_state)||""}><option value="">Any ownership</option><option value="unassigned">Unassigned now</option><option value="open">Open assignment</option><option value="done">Completed history</option><option value="never">Never assigned</option></select></div>
            <div className="chip"><select name="area_basis" aria-label="Square feet basis" defaultValue={firstValue(sp.area_basis)||"source"}><option value="source">Source sqft</option><option value="built_up">AI built-up sqft</option><option value="carpet">AI carpet sqft</option></select></div>
            <label className="toggle"><input type="checkbox" name="needs_review" value="1" defaultChecked={sp.needs_review==="1"}/>Needs AI review</label>
            {user.isAdmin && <MultiSelect name="assignee" label="Assigned to" value={sp.assignee} options={[{value:"none",label:"Unassigned now"},...assignees.map(a=>({value:a.email,label:a.name||a.email}))]}/>}
        </div>
      </FilterForm>

      {user.isAdmin && <SelectionSummary />}
      <CallGridHint />
      <div className="gridwrap">
        <table className="sheet db-collapsed call-collapsed">
          <thead>
            <tr className="colheads">
              <th className="rowgutter"></th>
              {user.isAdmin && (
                <th className="selcol"><input type="checkbox" className="selall" aria-label="Select all on this page" title="Select all on this page" /></th>
              )}
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
                <td className="identity-owner">{hl(r.owner_name, terms)} <RecordDetails id={r.id} entity="call" /></td>
                <td>
                  <CopyText
                    value={r.call_type === "inbound" ? r.from_number : r.to_number}
                    display={hl(r.call_type === "inbound" ? r.from_number : r.to_number, terms)}
                    label="phone number"
                  />
                </td>
                <td className={cfClass(r.availability)}>
                  {r.availability ?? ""}
                  {r.needs_review && <span className="review-tag" title="The AI inference has low confidence; review the transcript or recording.">Needs AI review</span>}
                  {!r.inferred && r.can_enrich && <EnrichButton id={r.id} />}
                </td>
                <td>{r.ai_attempt_count} known<br/><InlineAiTimeline entity="call" id={r.id}/></td>
                <td>{r.assignment_outcome||<span className="muted">No manual result</span>}{r.assignment_closure_reason==='exhausted'&&<><br/>Closed: Exhausted</>}<br/><RecordDetails id={r.id} entity="call" label="Manual history"/></td>
                <EditableCells canEdit={!!r.assignment_id && r.assignment_state !== "dropped"} revision={r.assignment_revision||0}
                  id={r.id}
                  assignmentId={r.assignment_id}
                  remarks={r.assignment_remarks}
                  calledBy={r.called_by}
                  addedToDb={!!r.assignment_added_to_db}
                  whId={r.assignment_wh_id}
                  legacyWhId={r.wh_id} legacyAdded={r.added_to_db}
                />
                <td>{fmtDate(r.call_created_at)}</td>
                <td>{r.call_type === "inbound" ? "Inbound" : "Outbound"}</td>
                <td title={r.agent_id || undefined}>{agentLabel(r.agent_id)}</td>
                <td>{r.source_cities ? hl(r.source_cities, terms) : <span className="muted">Unknown</span>}</td>
                <td>{hl(r.db_area, terms)}</td>
                <td>{number(r.built_up_area_sqft)}</td>
                <td>{number(r.carpet_area_sqft)}</td>
                <td>{rent(r.expected_rent)}</td>
                <td className="call-toggle">{r.status}</td>
                <td className="call-col clip" title={r.notes ?? ""}>{hl(r.notes, terms)}</td>
                <td className="call-col clip" title="Transcript preview; open Details for the full transcript">{hl(r.transcript, terms)}</td>
                <td className="call-col">{r.recording_url ? <a href={r.recording_url} target="_blank" rel="noreferrer">Play</a> : ""}</td>
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
                <td className="db-col">{number(r.raw_area_sqft)}</td>
                <td className="db-col clip" title={r.raw_sources ?? ""}>{hl(r.raw_sources, terms)}</td>
                {user.isAdmin && (
                  <td className="clip" title={r.assignment_note ?? ""}>
                    {r.assigned_to ?? <span className="muted">—</span>}
                    {!r.assigned_to && r.assignment_state === "done" && <span className="review-tag" title={`Previously assigned to ${r.assignment_assignee || "a caller"}; see Details`}>completed history</span>}
                  </td>
                )}
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
          {pageList(page, pages).map((t, i) =>
            t === "…"
              ? <span key={`e${i}`} className="ellipsis">…</span>
              : t === page
                ? <span key={t} className="cur">{t}</span>
                : <Link key={t} href={qs(sp, { page: String(t) })}>{t}</Link>,
          )}
          {page >= pages ? <button type="button" disabled aria-label="Next">›</button> : <Link href={qs(sp, { page: String(page + 1) })} aria-label="Next">›</Link>}
          {page >= pages ? <button type="button" disabled aria-label="Last">»</button> : <Link href={qs(sp, { page: String(pages) })} aria-label="Last">»</Link>}
        </div>
      </div>

      <PageJump key={page} page={page} pages={pages}/>

      <GridInteractivity />

    </SelectionProvider>
  );
}

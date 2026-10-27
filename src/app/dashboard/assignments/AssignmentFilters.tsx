import { countFilters, firstValue, type SearchValues } from "@/lib/filter-values";
import { MultiSelect } from "../MultiSelect";
import { ColumnChooser } from "../ColumnChooser";
import { FilterForm } from "../FilterForm";
import { FilterPanel } from "../FilterPanel";
import { FiltersToggle } from "../FiltersToggle";
import { ApplyButton } from "../ApplyButton";
import { OUTCOMES } from "@/lib/scope";
import { AiActivityFilter, DateFilters, ReportingFilters, REPORTING_FILTER_KEYS, SelectFilter } from "../FilterFields";

const RESULT_KEYS = ["comparison", "outcome", "ai_result", "has_ai_calls", ...REPORTING_FILTER_KEYS];
const WORK_KEYS = ["assignee", "state", "type", "city", "region", "assigned_by", "follow_up", "quality_review", "batch_id"];
const DATE_KEYS = ["date_from", "date_to", "completed_from", "completed_to", "sort"];
export const ASSIGNMENT_FILTER_KEYS = ["q", ...RESULT_KEYS, ...WORK_KEYS, ...DATE_KEYS];

export function AssignmentFilters({ applied, assignees = [], loading = false }: {
  applied: SearchValues; assignees?: { email: string; name: string | null }[]; loading?: boolean;
}) {
  const count = countFilters(applied, [...RESULT_KEYS, ...WORK_KEYS, ...DATE_KEYS]);
  const people = assignees.map(p => ({ value: p.email, label: p.name || p.email }));
  const controls = <>
    <div className="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
      <input name="q" defaultValue={firstValue(applied.q) || ""} disabled={loading} aria-label="Search assignments" placeholder="Search people, notes, phone…" />
    </div>
    <FiltersToggle count={count} disabled={loading} />
    {loading ? <button type="button" className="btn apply-button" disabled>Apply</button> : <ApplyButton />}
    {!loading && <FilterPanel groups={[
      { label: "Assignment", count: countFilters(applied, WORK_KEYS), content: <>
        <MultiSelect name="assignee" label="Assignee" value={applied.assignee} options={people} />
        <MultiSelect name="state" label="Status" value={applied.state} options={[{ value: "open", label: "Open" }, { value: "done", label: "Done" }, { value: "dropped", label: "Unassigned" }]} />
        <MultiSelect name="type" label="Channel" value={applied.type} options={[{ value: "record", label: "Manual (listing)" }, { value: "call", label: "AI call follow-up" }]} />
        <MultiSelect name="assigned_by" label="Assigned by" value={applied.assigned_by} options={people} />
        <label><span>Assignment batch ID</span><input pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}" title="Enter a complete batch UUID" name="batch_id" defaultValue={firstValue(applied.batch_id)||""} placeholder="Exact assignment batch ID"/></label>
        <label><span>City</span><input name="city" defaultValue={firstValue(applied.city) || ""} placeholder="Any city" /></label>
        <label><span>State</span><input name="region" aria-label="Filter by state" defaultValue={firstValue(applied.region) || ""} placeholder="Any state" /></label>
        <SelectFilter name="follow_up" label="Follow-up" applied={applied} options={[{ value: "pending", label: "Needs another call" }, { value: "due", label: "Due now / needs scheduling" }]} />
        <SelectFilter name="quality_review" label="Completion review" applied={applied} options={[{ value: "1", label: "Needs review" }]} />
      </> },
      { label: "Results", count: countFilters(applied, RESULT_KEYS), content: <>
        <SelectFilter name="comparison" label="AI–human comparison" applied={applied} any="All assignments" options={[{value:"mismatch",label:"Results disagree"}]} />
        <MultiSelect name="ai_result" label="AI result" value={applied.ai_result} options={[...OUTCOMES, { value: "dead number - do not call", label: "Dead number — do not call" }, { value: "none", label: "No AI result" }]} />
        <MultiSelect name="outcome" label="Manual result" value={applied.outcome} options={[...OUTCOMES, { value: "none", label: "No manual result" }]} />
        <AiActivityFilter applied={applied}/>
        <ReportingFilters applied={applied} />
      </> },
      { label: "Dates & order", count: countFilters(applied, DATE_KEYS), content: <>
        <DateFilters applied={applied} label="Assigned date" />
        <DateFilters applied={applied} label="Completed date" fromName="completed_from" toName="completed_to"/>
        <p className="filter-explanation">Completion dates include done assignments with a recorded completion date.</p>
        <SelectFilter name="sort" label="Sort" applied={applied} any="Newest first" options={[{ value: "oldest", label: "Oldest first" }, { value: "name", label: "Name A–Z" }]} />
      </> },
    ]} />}
  </>;
  return loading ? <div className="filterbar assignment-filters records-toolbar"><div className="toolbar-search">{controls}</div><div className="toolbar-view"><details className="column-menu"><summary>Columns</summary></details><details className="column-menu views-menu"><summary>Views</summary></details></div></div>
    : <FilterForm key={JSON.stringify(applied)} action="/dashboard/assignments" applied={applied} className="assignment-filters" viewTools={<ColumnChooser />}>{controls}</FilterForm>;
}

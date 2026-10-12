import { firstValue, type SearchValues } from "@/lib/filter-values";
import { MultiSelect } from "../MultiSelect";
import { ColumnChooser } from "../ColumnChooser";
import { FilterForm } from "../FilterForm";
import { FilterPanel } from "../FilterPanel";
import { FiltersToggle } from "../FiltersToggle";
import { ApplyButton } from "../ApplyButton";
import { IconFilter } from "../icons";
import { OUTCOMES } from "@/lib/scope";

export function AssignmentFilters({ applied, assignees = [], loading = false }: {
  applied: SearchValues; assignees?: { email: string; name: string | null }[]; loading?: boolean;
}) {
  const moreCount = ["type", "outcome"].filter(key => applied[key]).length;
  const controls = <>
    {["batch_id","quality_review","follow_up"].map(key=>firstValue(applied[key])&&<input type="hidden" key={key} name={key} value={firstValue(applied[key])}/>)}
    <MultiSelect name="assignee" label="Assignee" value={applied.assignee} disabled={loading} options={assignees.map(p=>({value:p.email,label:p.name||p.email}))}/>
    <MultiSelect name="state" label="Status" value={applied.state} disabled={loading} options={[{value:"open",label:"Open"},{value:"done",label:"Done"},{value:"dropped",label:"Unassigned"}]}/>
    <div className="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
      <input name="q" defaultValue={firstValue(applied.q)||""} disabled={loading} aria-label="Search assignments" placeholder="Search people, notes, phone…" />
    </div>
    {loading ? <button type="button" className={`filters-toggle${moreCount ? " active" : ""}`} disabled><IconFilter size={15} />More filters{moreCount > 0 && <span className="fbadge">{moreCount}</span>}</button> : <FiltersToggle count={moreCount} label="More filters" />}
    {loading ? <button type="button" className="btn apply-button" disabled>Apply</button> : <ApplyButton />}
    {loading ? <details className="column-menu"><summary>Columns</summary></details> : <ColumnChooser/>}<span className="spacer" /><a className="btn-text" href={loading ? undefined : "/dashboard/assignments"}>Reset</a>
    {!loading && <FilterPanel groups={[{ label: "Assignment", content: <>
      <MultiSelect name="type" label="Channel" value={applied.type} options={[{value:"record",label:"Manual (listing)"},{value:"call",label:"AI call follow-up"}]}/>
      <MultiSelect name="outcome" label="Manual result" value={applied.outcome} options={[...OUTCOMES,{value:"none",label:"No result yet"}]}/>

    </> }]} />}
  </>;
  return loading ? <div className="filterbar assignment-filters">{controls}<details className="column-menu views-menu"><summary>Views</summary></details></div>
    : <FilterForm key={JSON.stringify(applied)} action="/dashboard/assignments" applied={applied} className="assignment-filters">{controls}</FilterForm>;
}

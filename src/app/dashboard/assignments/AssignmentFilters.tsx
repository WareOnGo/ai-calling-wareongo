import { FilterForm } from "../FilterForm";
import { FiltersToggle } from "../FiltersToggle";
import { ApplyButton } from "../ApplyButton";
import { IconFilter } from "../icons";
import { OUTCOMES } from "@/lib/scope";

export function AssignmentFilters({ applied, assignees = [], loading = false }: {
  applied: Record<string, string | undefined>; assignees?: { email: string; name: string | null }[]; loading?: boolean;
}) {
  const moreCount = ["type", "outcome"].filter(key => applied[key]).length;
  const people = applied.assignee && !assignees.some(person => person.email === applied.assignee)
    ? [...assignees, { email: applied.assignee, name: null }] : assignees;
  const controls = <>
    <label className={`assignment-filter chip${applied.assignee ? " active" : ""}`}>
      <span>Assignee</span><select name="assignee" aria-label="assignee" defaultValue={applied.assignee || ""} disabled={loading}>
        <option value="">All assignees</option>{people.map(person => <option key={person.email} value={person.email}>{person.name || person.email}</option>)}
      </select>
    </label>
    <label className={`assignment-filter chip${applied.state ? " active" : ""}`}>
      <span>Status</span><select name="state" aria-label="state" defaultValue={applied.state || ""} disabled={loading}>
        <option value="">Any status</option><option value="open">Open</option><option value="done">Done</option><option value="dropped">Unassigned</option>
      </select>
    </label>
    <div className="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
      <input name="q" defaultValue={applied.q || ""} disabled={loading} aria-label="Search assignments" placeholder="Search people, notes, phone…" />
    </div>
    {loading ? <button type="button" className={`filters-toggle${moreCount ? " active" : ""}`} disabled><IconFilter size={15} />More filters{moreCount > 0 && <span className="fbadge">{moreCount}</span>}</button> : <FiltersToggle count={moreCount} label="More filters" />}
    {loading ? <button type="button" className="btn apply-button" disabled>Apply</button> : <ApplyButton />}
    <span className="spacer" /><a className="btn-text" href={loading ? undefined : "/dashboard/assignments"}>Reset</a>
    {!loading && <div className="filters-panel" id="filters-panel">
      <div className={`chip${applied.type ? " active" : ""}`}><select aria-label="type" name="type" defaultValue={applied.type || ""}>
        <option value="">Both channels</option><option value="record">Manual (listing)</option><option value="call">AI call follow-up</option>
      </select></div>
      <div className={`chip${applied.outcome ? " active" : ""}`}><select aria-label="outcome" name="outcome" defaultValue={applied.outcome || ""}>
        <option value="">Any result</option><option value="none">No result yet</option>{OUTCOMES.map(outcome => <option key={outcome}>{outcome}</option>)}
      </select></div>
    </div>}
  </>;
  return loading ? <div className="filterbar assignment-filters">{controls}<details className="column-menu views-menu"><summary>Views</summary></details></div>
    : <FilterForm key={JSON.stringify(applied)} action="/dashboard/assignments" applied={applied} className="assignment-filters">{controls}</FilterForm>;
}

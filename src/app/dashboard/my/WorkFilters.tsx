"use client";

import { FilterForm } from "../FilterForm";
import { FiltersToggle } from "../FiltersToggle";
import { ApplyButton } from "../ApplyButton";
import { IconFilter } from "../icons";
import { OUTCOMES } from "@/lib/scope";
import { WORK_FILTER_LABELS, WORK_SORT_LABELS, workFilterValue, workHref, type WorkFilters as Filters } from "@/lib/work-filters";

export function WorkFilters({ filters, assigners = [], loading = false }: { filters: Filters; assigners?: { email: string; name: string | null }[]; loading?: boolean }) {
  const moreCount = ["city", "assigned_by", "added_to_db", "sort"].filter(key => filters[key as keyof Filters]).length;
  const people = filters.assigned_by && !assigners.some(person => person.email === filters.assigned_by) ? [...assigners, { email: filters.assigned_by, name: null }] : assigners;
  const controls = <>
    {filters.view && <input type="hidden" name="view" value={filters.view} />}
    <div className="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
      <input name="q" defaultValue={filters.q || ""} disabled={loading} aria-label="Search my work" placeholder="Search contact, phone or notes…" />
    </div>
    <label className={`work-filter chip${filters.type ? " active" : ""}`}><span>Work type</span><select aria-label="Work type" name="type" defaultValue={filters.type || ""} disabled={loading}>
      <option value="">All work</option><option value="record">Listings</option><option value="call">AI follow-ups</option>
    </select></label>
    <label className={`work-filter chip${filters.outcome ? " active" : ""}`}><span>Result</span><select aria-label="Filter by result" name="outcome" defaultValue={filters.outcome || ""} disabled={loading}>
      <option value="">Any result</option><option value="none">Not called yet</option>{OUTCOMES.map(outcome => <option key={outcome}>{outcome}</option>)}
    </select></label>
    {loading ? <button className={`filters-toggle${moreCount ? " active" : ""}`} type="button" disabled><IconFilter size={15} />More filters{moreCount > 0 && <span className="fbadge">{moreCount}</span>}</button> : <FiltersToggle label="More filters" count={moreCount} />}
    {loading ? <button type="button" className="btn apply-button" disabled>Apply</button> : <ApplyButton />}
    <span className="spacer" /><a className="btn-text" href={loading ? undefined : workHref({ view: filters.view })}>Reset</a>
    {!loading && <div className="filters-panel work-more-filters" id="filters-panel">
      <label className="work-filter"><span>City</span><input className="field" name="city" aria-label="Filter by city" defaultValue={filters.city || ""} placeholder="Any city" /></label>
      <label className={`work-filter chip${filters.assigned_by ? " active" : ""}`}><span>Assigned by</span><select aria-label="Assigned by" name="assigned_by" defaultValue={filters.assigned_by || ""}>
        <option value="">Anyone</option>{people.map(person => <option value={person.email} key={person.email}>{person.name || person.email}</option>)}
      </select></label>
      <label className={`work-filter chip${filters.added_to_db ? " active" : ""}`}><span>In DB</span><select aria-label="Filter by database status" name="added_to_db" defaultValue={filters.added_to_db || ""}>
        <option value="">Any</option><option value="yes">Added</option><option value="no">Not added</option>
      </select></label>
      <label className={`work-filter chip${filters.sort ? " active" : ""}`}><span>Sort</span><select aria-label="Sort my work" name="sort" defaultValue={filters.sort || ""}>
        <option value="">{WORK_SORT_LABELS.newest}</option><option value="oldest">{WORK_SORT_LABELS.oldest}</option><option value="name">{WORK_SORT_LABELS.name}</option>
      </select></label>
    </div>}
  </>;
  if (!loading) return <FilterForm action="/dashboard/my" className="work-filters" applied={filters} preserveKeys={["view"]} labels={WORK_FILTER_LABELS} formatValue={workFilterValue}>{controls}</FilterForm>;
  const active = Object.entries(filters).filter(([key]) => WORK_FILTER_LABELS[key]);
  return <><div className="filterbar work-filters">{controls}<details className="column-menu views-menu"><summary>Views</summary></details></div>
    {!!active.length && <div className="applied-filters">{active.map(([key, value]) => <button className="filter-tag" type="button" key={key} disabled>{WORK_FILTER_LABELS[key]}: {workFilterValue(key, value)}<span>×</span></button>)}<button className="btn-text" type="button" disabled>Clear filters</button></div>}
  </>;
}

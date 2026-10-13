"use client";

import { DateFilters, ReportingFilters, SelectFilter } from "../FilterFields";
import { FilterForm } from "../FilterForm";
import { FilterPanel } from "../FilterPanel";
import { FiltersToggle } from "../FiltersToggle";
import { ApplyButton } from "../ApplyButton";
import { IconFilter } from "../icons";
import { OUTCOMES } from "@/lib/scope";
import { WORK_FILTER_LABELS, WORK_SORT_LABELS, workFilterValue, workHref, type WorkFilters as Filters } from "@/lib/work-filters";

export function WorkFilters({ filters, assigners = [], loading = false }: { filters: Filters; assigners?: { email: string; name: string | null }[]; loading?: boolean }) {
  const moreCount = ["city", "assigned_by", "added_to_db", "sort", "ai_result", "wh_id", "has_notes", "has_manual_calls", "date_from", "date_to"].filter(key => filters[key as keyof Filters]).length;
  const people = filters.assigned_by && !assigners.some(person => person.email === filters.assigned_by) ? [...assigners, { email: filters.assigned_by, name: null }] : assigners;
  const controls = <>
    {filters.view && <input type="hidden" name="view" value={filters.view} />}
    <div className="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
      <input name="q" defaultValue={filters.q || ""} disabled={loading} aria-label="Search my work" placeholder="Search contact, phone or notes…" />
    </div>
    <label className={`work-filter chip${filters.type ? " active" : ""}`}><span>Work type</span><select aria-label="Work type" name="type" defaultValue={filters.type || ""} disabled={loading}>
      <option value="">All work</option><option value="record">Listings</option><option value="call">AI follow-ups</option>
    </select></label>
    <label className={`work-filter chip${filters.outcome ? " active" : ""}`}><span>Manual result</span><select aria-label="Filter by result" name="outcome" defaultValue={filters.outcome || ""} disabled={loading}>
      <option value="">Any result</option><option value="none">No manual result</option>{OUTCOMES.map(outcome => <option key={outcome}>{outcome}</option>)}
    </select></label>
    <label className="work-filter chip"><span>Follow-up</span><select name="follow_up" aria-label="Follow-up" defaultValue={filters.follow_up||""} disabled={loading}><option value="">All tasks</option><option value="pending">Needs another call</option><option value="due">Due now / needs scheduling</option></select></label>
    {loading ? <button className={`filters-toggle${moreCount ? " active" : ""}`} type="button" disabled><IconFilter size={15} />More filters{moreCount > 0 && <span className="fbadge">{moreCount}</span>}</button> : <FiltersToggle label="More filters" count={moreCount} />}
    {loading ? <button type="button" className="btn apply-button" disabled>Apply</button> : <ApplyButton />}
    <span className="spacer" /><a className="btn-text" href={loading ? undefined : workHref({ view: filters.view })}>Reset</a>
    {!loading && <FilterPanel groups={[
      { label: "Results", count: ["ai_result", "added_to_db", "wh_id", "has_notes", "has_manual_calls"].filter(key => filters[key as keyof Filters]).length, content: <>
        <SelectFilter name="ai_result" label="AI result" applied={filters} options={[...OUTCOMES, {value:"dead number - do not call",label:"Dead number — do not call"}, {value:"none",label:"No AI result"}]} />
        <ReportingFilters applied={filters} />
      </> },
      { label: "Assignment", count: ["city", "assigned_by"].filter(key => filters[key as keyof Filters]).length, content: <>
        <label><span>City</span><input name="city" aria-label="Filter by city" defaultValue={filters.city || ""} placeholder="Any city" /></label>
        <SelectFilter name="assigned_by" label="Assigned by" applied={filters} any="Anyone" options={people.map(person => ({value:person.email,label:person.name||person.email}))} />
      </> },
      { label: "Dates & order", count: ["date_from", "date_to", "sort"].filter(key => filters[key as keyof Filters]).length, content: <>
        <DateFilters applied={filters} label="Assigned date" />
        <SelectFilter name="sort" label="Sort" ariaLabel="Sort my work" applied={filters} any={WORK_SORT_LABELS.newest} options={[{value:"oldest",label:WORK_SORT_LABELS.oldest},{value:"name",label:WORK_SORT_LABELS.name}]} />
      </> },
    ]} />}

  </>;
  if (!loading) return <FilterForm action="/dashboard/my" className="work-filters" applied={filters} preserveKeys={["view"]} labels={WORK_FILTER_LABELS} formatValue={workFilterValue}>{controls}</FilterForm>;
  const active = Object.entries(filters).filter(([key]) => WORK_FILTER_LABELS[key]);
  return <><div className="filterbar work-filters">{controls}<details className="column-menu views-menu"><summary>Views</summary></details></div>
    {!!active.length && <div className="applied-filters">{active.map(([key, value]) => <button className="filter-tag" type="button" key={key} disabled>{WORK_FILTER_LABELS[key]}: {workFilterValue(key, value)}<span>×</span></button>)}<button className="btn-text" type="button" disabled>Clear filters</button></div>}
  </>;
}

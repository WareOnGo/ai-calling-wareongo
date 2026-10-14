"use client";

import { AiActivityFilter, DateFilters, ReportingFilters, SelectFilter } from "../FilterFields";
import { FilterForm } from "../FilterForm";
import { FilterPanel } from "../FilterPanel";
import { FiltersToggle } from "../FiltersToggle";
import { ApplyButton } from "../ApplyButton";
import { filterValues } from "@/lib/filter-values";
import { OUTCOMES } from "@/lib/scope";
import { WORK_FILTER_LABELS, WORK_SORT_LABELS, workFilterValue, type WorkFilters as Filters } from "@/lib/work-filters";

export function WorkFilters({ filters, assigners = [], loading = false }: { filters: Filters; assigners?: { email: string; name: string | null }[]; loading?: boolean }) {
  const count = ["type", "outcome", "follow_up", "city", "assigned_by", "added_to_db", "sort", "ai_result", "wh_id", "has_notes", "has_manual_calls", "date_from", "date_to", "completed_from", "completed_to", "has_ai_calls", "manual_disposition"].filter(key => filters[key as keyof Filters]).length;
  const people = filters.assigned_by && !assigners.some(person => person.email === filters.assigned_by) ? [...assigners, { email: filters.assigned_by, name: null }] : assigners;
  const controls = <>
    {filters.view && <input type="hidden" name="view" value={filters.view} />}
    <div className="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
      <input name="q" defaultValue={filters.q || ""} disabled={loading} aria-label="Search my work" placeholder="Search contact, phone or notes…" />
    </div>
    <FiltersToggle count={count} disabled={loading} />
    {loading ? <button type="button" className="btn apply-button" disabled>Apply</button> : <ApplyButton />}
    {!loading && <FilterPanel groups={[
      { label: "Assignment", count: ["type", "follow_up", "city", "assigned_by"].filter(key => filters[key as keyof Filters]).length, content: <>
        <SelectFilter name="type" label="Work type" applied={filters} any="All work" options={[{ value: "record", label: "Listings" }, { value: "call", label: "AI follow-ups" }]} />
        <SelectFilter name="follow_up" label="Follow-up" applied={filters} any="All tasks" options={[{ value: "pending", label: "Needs another call" }, { value: "due", label: "Due now / needs scheduling" }]} />
        <label><span>City</span><input name="city" aria-label="Filter by city" defaultValue={filters.city || ""} placeholder="Any city" /></label>
        <SelectFilter name="assigned_by" label="Assigned by" applied={filters} any="Anyone" options={people.map(person => ({value:person.email,label:person.name||person.email}))} />
      </> },
      { label: "Results", count: ["outcome", "ai_result", "added_to_db", "wh_id", "has_notes", "has_manual_calls", "has_ai_calls", "manual_disposition"].filter(key => filters[key as keyof Filters]).length, content: <>
        <SelectFilter name="outcome" label="Manual result" ariaLabel="Filter by result" applied={filters} any="Any result" options={[{ value: "none", label: "No manual result" }, ...OUTCOMES]} />
        <SelectFilter name="ai_result" label="AI result" applied={filters} options={[...OUTCOMES, {value:"dead number - do not call",label:"Dead number — do not call"}, {value:"none",label:"No AI result"}]} />
        <AiActivityFilter applied={filters}/>
        <ReportingFilters applied={filters} />
      </> },
      { label: "Dates & order", count: ["date_from", "date_to", "completed_from", "completed_to", "sort"].filter(key => filters[key as keyof Filters]).length, content: <>
        <DateFilters applied={filters} label="Assigned date" />
        <DateFilters applied={filters} label="Completed date" fromName="completed_from" toName="completed_to"/>
        <p className="filter-explanation">Completion dates apply to done tasks with a recorded completion date.</p>
        <SelectFilter name="sort" label="Sort" ariaLabel="Sort my work" applied={filters} any={WORK_SORT_LABELS.newest} options={[{value:"oldest",label:WORK_SORT_LABELS.oldest},{value:"name",label:WORK_SORT_LABELS.name}]} />
      </> },
    ]} />}

  </>;
  if (!loading) return <FilterForm action="/dashboard/my" className="work-filters" applied={filters} preserveKeys={["view"]} labels={WORK_FILTER_LABELS} formatValue={workFilterValue}>{controls}</FilterForm>;
  const active = Object.entries(filters).filter(([key]) => WORK_FILTER_LABELS[key]).flatMap(([key,value])=>filterValues(value).map(item=>[key,item] as const));
  return <><div className="filterbar work-filters records-toolbar"><div className="toolbar-search">{controls}</div><div className="toolbar-view"><details className="column-menu views-menu"><summary>Views</summary></details></div></div>
    {!!active.length && <div className="applied-filters">{active.map(([key, value]) => <button className="filter-tag" type="button" key={`${key}:${value}`} disabled>{WORK_FILTER_LABELS[key]}: {workFilterValue(key, value)}<span>×</span></button>)}<button className="btn-text" type="button" disabled>Clear filters</button></div>}
  </>;
}

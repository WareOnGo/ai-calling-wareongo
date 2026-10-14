"use client";

import type { teamDates, TeamFilters } from "@/lib/team-report";
import { countFilters } from "@/lib/filter-values";
import { shortDate } from "@/lib/display";
import { FilterForm } from "../FilterForm";
import { FilterPanel } from "../FilterPanel";
import { FiltersToggle } from "../FiltersToggle";
import { ApplyButton } from "../ApplyButton";
import { SelectFilter } from "../FilterFields";

export function TeamDateRange({ filters, dates, people = [] }: { filters: TeamFilters; dates: ReturnType<typeof teamDates>; people?: {email:string;name:string|null}[] }) {
  const applied={date_from:filters.date_from,date_to:filters.date_to,person:filters.person,access:filters.access};
  return <div className="team-report-filters"><FilterForm key={JSON.stringify(applied)} action="/dashboard/team" applied={applied} preserveKeys={["date_from","date_to"]} savedViews={false} labels={{date_from:"",date_to:"",person:"Caller",access:"Access"}}>
    <span className="filter-context">{shortDate(`${filters.date_from}T00:00:00+05:30`)} – {shortDate(`${filters.date_to}T00:00:00+05:30`)} <span className="muted">IST</span></span>
    <FiltersToggle count={countFilters(applied,["person","access"]) + (filters.date_from !== dates.week || filters.date_to !== dates.today ? 1 : 0)}/><ApplyButton/>
    <FilterPanel groups={[
      { label: "Team", count: countFilters(applied,["person","access"]), content: <>
        <SelectFilter name="person" label="Caller" applied={applied} any="All callers" options={people.map(p=>({value:p.email,label:p.name||p.email}))} />
        <SelectFilter name="access" label="Access" applied={applied} any="All members" options={[{value:"active",label:"Current access"},{value:"removed",label:"Access removed"}]} />
      </> },
      { label: "Dates", content: <>
        <div className="filter-presets" role="group" aria-label="Report date presets">{[["Today",dates.today,dates.today],["Yesterday",dates.yesterday,dates.yesterday],["Last 7 days",dates.week,dates.today],["This month",dates.month,dates.today]].map(([label,from,to])=><button type="button" className="btn-row" key={label} onClick={event=>{
          const form=event.currentTarget.closest('form')!;
          for(const [name,value] of [["date_from",from],["date_to",to]]) {
            const input=form.elements.namedItem(name) as HTMLInputElement;
            input.value=value; input.dispatchEvent(new Event('input',{bubbles:true}));
          }
        }}>{label}</button>)}</div>
        <label>From<input aria-label="Report from" type="date" name="date_from" defaultValue={filters.date_from} required/></label>
        <label>To<input aria-label="Report to" type="date" name="date_to" defaultValue={filters.date_to} required/></label>
        <p className="filter-explanation">Dates include the full day in IST.</p>
      </> },
    ]}/>
  </FilterForm></div>;
}

import Link from "next/link";
import type { teamDates, TeamFilters } from "@/lib/team-report";
import { searchQuery } from "@/lib/filter-values";
import { FilterForm } from "../FilterForm";
import { ApplyButton } from "../ApplyButton";
import { SelectFilter } from "../FilterFields";

export function TeamDateRange({ filters, dates, people = [] }: { filters: TeamFilters; dates: ReturnType<typeof teamDates>; people?: {email:string;name:string|null}[] }) {
  const applied={date_from:filters.date_from,date_to:filters.date_to,person:filters.person,access:filters.access};
  return <div className="team-report-filters"><FilterForm key={JSON.stringify(applied)} action="/dashboard/team" applied={applied} preserveKeys={["date_from","date_to"]} savedViews={false} labels={{date_from:"",date_to:"",person:"Caller",access:"Access"}}>
    <div className="team-date-fields">
      <label>From<input aria-label="Report from" type="date" name="date_from" defaultValue={filters.date_from} required/></label>
      <label>To<input aria-label="Report to" type="date" name="date_to" defaultValue={filters.date_to} required/></label>
      <SelectFilter name="person" label="Caller" applied={applied} any="All callers" options={people.map(p=>({value:p.email,label:p.name||p.email}))} />
      <SelectFilter name="access" label="Access" applied={applied} any="All members" options={[{value:"active",label:"Current access"},{value:"removed",label:"Access removed"}]} />
      <ApplyButton label="Apply dates & filters" />
    </div>
  </FilterForm>
  <div className="team-report-presets"><nav className="team-date-presets" aria-label="Report date presets">{[["Today",dates.today,dates.today],["Yesterday",dates.yesterday,dates.yesterday],["Last 7 days",dates.week,dates.today],["This month",dates.month,dates.today]].map(([label,from,to])=><Link key={label} aria-current={filters.date_from===from&&filters.date_to===to?"date":undefined} href={"/dashboard/team?"+searchQuery({...applied,date_from:from,date_to:to})}>{label}</Link>)}</nav><span className="team-date-zone">Dates in IST</span></div>
  </div>;
}

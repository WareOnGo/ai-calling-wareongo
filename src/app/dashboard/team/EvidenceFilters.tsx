import type { TeamFilters } from "@/lib/team-report";
import { FilterForm } from "../FilterForm";
import { ApplyButton } from "../ApplyButton";
import { SelectFilter, YesNoFilter } from "../FilterFields";
import { FilterPanel } from "../FilterPanel";
import { FiltersToggle } from "../FiltersToggle";

export function EvidenceFilters({filters}:{filters:TeamFilters}) {
  const {page:_,...applied}=filters;
  const context=["range","date_from","date_to","person","access","caller","metric"];
  return <FilterForm key={JSON.stringify(applied)} action="/dashboard/team" applied={applied} savedViews={false} preserveKeys={context} labels={{range:"",date_from:"",date_to:"",person:"",access:"",caller:"",q:"Evidence search",state:"Current task state"}}>
    {context.map(key=>{const value=applied[key as keyof typeof applied];return value&&<input key={key} type="hidden" name={key} value={value} />;})}
    <div className="search"><input name="q" aria-label="Search evidence" placeholder="Search target or evidence…" defaultValue={filters.q||""} /></div>
    <FiltersToggle count={[filters.state,filters.entity_type,filters.has_duration].filter(Boolean).length}/><ApplyButton />
    <FilterPanel groups={[{ label: "Evidence", content: <><SelectFilter name="state" label="Current task state" applied={applied} options={[{value:"open",label:"Open"},{value:"done",label:"Done"},{value:"dropped",label:"Unassigned"}]} />
      <SelectFilter name="entity_type" label="Work type" applied={applied} options={[{value:"record",label:"Listings"},{value:"call",label:"AI follow-ups"}]}/>
      <YesNoFilter name="has_duration" label="Reported duration" applied={applied} yes="Duration recorded" no="Duration unknown"/>
    </> }]}/>
  </FilterForm>;
}

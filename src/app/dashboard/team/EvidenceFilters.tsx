import type { TeamFilters } from "@/lib/team-report";
import { FilterForm } from "../FilterForm";
import { ApplyButton } from "../ApplyButton";
import { SelectFilter } from "../FilterFields";

export function EvidenceFilters({filters}:{filters:TeamFilters}) {
  const {page:_,...applied}=filters;
  const context=["date_from","date_to","person","access","caller","metric"];
  return <FilterForm key={JSON.stringify(applied)} action="/dashboard/team" applied={applied} savedViews={false} preserveKeys={context} labels={{date_from:"",date_to:"",person:"",access:"",caller:"",q:"Evidence search",state:"Current task state"}}>
    {context.map(key=>{const value=applied[key as keyof typeof applied];return value&&<input key={key} type="hidden" name={key} value={value} />;})}
    <div className="search"><input name="q" aria-label="Search evidence" placeholder="Search target or evidence…" defaultValue={filters.q||""} /></div>
    <SelectFilter name="state" label="Current task state" applied={applied} options={[{value:"open",label:"Open"},{value:"done",label:"Done"},{value:"dropped",label:"Unassigned"}]} />
    <ApplyButton />
  </FilterForm>;
}

import { countFilters, firstValue, type SearchValues } from "@/lib/filter-values";
import { FilterForm } from "../FilterForm";
import { FilterPanel } from "../FilterPanel";
import { FiltersToggle } from "../FiltersToggle";
import { ApplyButton } from "../ApplyButton";
import { DateFilters, SelectFilter } from "../FilterFields";
import { MultiSelect } from "../MultiSelect";

export function BatchFilters({ applied, kind, people }: { applied: SearchValues; kind: "ai" | "manual"; people: {email:string;name:string|null}[] }) {
  const manual = kind === "manual";
  return <FilterForm key={JSON.stringify(applied)} action="/dashboard/batches" applied={{...applied,kind}} preserveKeys={["kind"]} className="batch-filter-toolbar" labels={{caller:manual?"Caller":"Created by",dispatch:"Dispatch ID",date_from:"Created from",date_to:"Created to"}}>
    <input type="hidden" name="kind" value={kind} />
    <div className="search"><input name="q" aria-label="Search batches" placeholder="Search batch ID or creator…" defaultValue={firstValue(applied.q)||""} /></div>
    <MultiSelect name="state" label="Status" value={applied.state} options={manual?[{value:"open",label:"Open"},{value:"closed",label:"Closed"}]:[
      {value:"creating",label:"Creating"},{value:"scheduling",label:"Scheduling"},{value:"scheduled",label:"Awaiting confirmation"},{value:"uncertain",label:"Needs confirmation"},{value:"completed",label:"Completed"},{value:"canceled",label:"Canceled"},{value:"failed",label:"Failed"},{value:"stubbed",label:"Preview only"},
    ]} />
    <FiltersToggle label="More filters" count={countFilters(applied,["caller","date_from","date_to","agent","dispatch","origin","language"])} /><ApplyButton />
    <FilterPanel groups={[
      {label:"Batch details",count:countFilters(applied,["caller","origin","language"]),content:<>
        <SelectFilter name="caller" label={manual?"Caller":"Created by"} applied={applied} any="Anyone" options={people.map(p=>({value:p.email,label:p.name||p.email}))} />
        {manual ? <SelectFilter name="origin" label="Work type" applied={applied} options={[{value:"record",label:"Raw Dataset"},{value:"call",label:"Calls"}]} />
          : <SelectFilter name="language" label="Language" applied={applied} options={[{value:"english",label:"English"},{value:"hindi",label:"Hindi"}]} />}
      </>},
      {label:"Dates & references",count:countFilters(applied,["date_from","date_to","agent","dispatch"]),content:<>
        <DateFilters applied={applied} label="Created date" />
        {!manual && <><label><span>Agent ID</span><input name="agent" defaultValue={firstValue(applied.agent)||""} placeholder="Any agent" /></label><label><span>Dispatch ID</span><input name="dispatch" defaultValue={firstValue(applied.dispatch)||""} placeholder="Exact dispatch ID" /></label></>}
      </>},
    ]} />
  </FilterForm>;
}

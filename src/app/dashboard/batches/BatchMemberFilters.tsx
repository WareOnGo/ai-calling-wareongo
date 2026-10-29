import { allocationLabel } from "@/lib/manual-dispositions";
import { countFilters, firstValue, type SearchValues } from "@/lib/filter-values";
import { FilterForm } from "../FilterForm";
import { FilterPanel } from "../FilterPanel";
import { FiltersToggle } from "../FiltersToggle";
import { ApplyButton } from "../ApplyButton";
import { YesNoFilter } from "../FilterFields";
import { MultiSelect } from "../MultiSelect";

export function BatchMemberFilters({path,applied,kind,options}:{path:string;applied:SearchValues;kind:"ai"|"manual";options:{states:string[];callers:string[];owners:string[]}}) {
  const manual=kind==='manual';
  return <FilterForm key={JSON.stringify(applied)} action={path} applied={applied} preserveKeys={["metric"]} savedViews={false} labels={{outcome:manual?"Manual result":"AI result",current_owner:"Current owner",assignee:"Original caller",connected:manual?"Logged connection":"Connected",onboarded:"Added to DB with WH ID"}}>
    {firstValue(applied.metric)&&<input type="hidden" name="metric" value={firstValue(applied.metric)} />}
    <div className="search"><input name="q" aria-label="Search batch members" placeholder="Search contact or phone…" defaultValue={firstValue(applied.q)||""} /></div>
    <FiltersToggle count={countFilters(applied,["outcome","city","state","assignee","current_owner","has_attempts","connected","onboarded","wh_id","allocation","warehouse_match"])} /><ApplyButton />
    <FilterPanel groups={[
      {label:"Call activity",count:countFilters(applied,["outcome","state","has_attempts","connected"]),content:<>
        <MultiSelect name="outcome" label={manual?"Manual result":"AI result"} value={applied.outcome} options={["Available","Unavailable","Unclear",...(!manual?[{value:"dead number - do not call",label:"Dead number — do not call"}]:[]),{value:"none",label:"No result"}]} />
        <MultiSelect name="state" label={manual?"Assignment status":"Call status"} value={applied.state} options={options.states} />
        <YesNoFilter name="has_attempts" label="Recorded attempts" applied={applied} yes="At least one attempt" no="No attempts recorded" />
        <YesNoFilter name="connected" label={manual?"Logged connection":"Connected"} applied={applied} />
      </>},
      {label:"Contact & ownership",count:countFilters(applied,["city","assignee","current_owner","onboarded","wh_id","allocation","warehouse_match"]),content:<>
        <label><span>City</span><input name="city" placeholder="Any city" defaultValue={firstValue(applied.city)||""} /></label>
        <YesNoFilter name="warehouse_match" label="Warehouse DB match" applied={applied} yes="Warehouse already added" no="No warehouse match" />
        <label><span>WH ID</span><input name="wh_id" placeholder="Exact warehouse ID" defaultValue={firstValue(applied.wh_id)||""} /></label>
        {manual&&<><MultiSelect name="allocation" label="Allocation" value={applied.allocation} options={['assign','reassign','owned','duplicate','missing_phone','warehouse_exists','legacy'].map(value=>({value,label:allocationLabel(value)}))}/>
<MultiSelect name="assignee" label="Original caller" value={applied.assignee} options={[...options.callers,{value:"none",label:"Not assigned"}]} />
          <MultiSelect name="current_owner" label="Current owner" value={applied.current_owner} options={[...options.owners,{value:"none",label:"Unassigned"}]} />
          <YesNoFilter name="onboarded" label="Added to DB with WH ID" applied={applied} /></>}
      </>},
    ]} />
  </FilterForm>;
}

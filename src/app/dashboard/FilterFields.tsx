import { DISPOSITIONS, dispositionLabel } from "@/lib/manual-dispositions";
import { MultiSelect } from "./MultiSelect";
import { firstValue, type SearchValues } from "@/lib/filter-values";

type Choice = string | { value: string; label: string };
export function SelectFilter({ name, label, applied, options, any = "Any", ariaLabel }: {
  name: string; label: string; applied: SearchValues; options: Choice[]; any?: string; ariaLabel?: string;
}) {
  const selected=firstValue(applied[name]) || "";
  const choices=options.map(option=>typeof option === "string" ? {value:option,label:option} : option);
  if(selected && !choices.some(option=>option.value===selected)) choices.push({value:selected,label:selected});
  return <label><span>{label}</span><select name={name} aria-label={ariaLabel || label} defaultValue={selected}>
    <option value="">{any}</option>{choices.map(option => {
      const item = typeof option === "string" ? { value: option, label: option } : option;
      return <option key={item.value} value={item.value}>{item.label}</option>;
    })}
  </select></label>;
}

export function YesNoFilter({ name, label, applied, yes = "Yes", no = "No", ariaLabel }: {
  name: string; label: string; applied: SearchValues; yes?: string; no?: string; ariaLabel?: string;
}) {
  return <SelectFilter {...{ name, label, applied, ariaLabel }} options={[{ value: "yes", label: yes }, { value: "no", label: no }]} />;
}

export function ReportingFilters({ applied }: { applied: SearchValues }) {
  return <>
    <YesNoFilter name="added_to_db" label="Added to DB" applied={applied} yes="Added" no="Not added" />
    <label><span>WH ID</span><input name="wh_id" aria-label="WH ID" defaultValue={firstValue(applied.wh_id) || ""} placeholder="e.g. 261" /><small>Matches a complete warehouse ID.</small></label>
    <YesNoFilter name="has_notes" label="Manual notes" applied={applied} yes="Has notes" no="No notes" />
    <YesNoFilter name="has_manual_calls" label="Manual calls logged" applied={applied} yes="At least one call" no="No calls logged" />
    <MultiSelect name="manual_disposition" label="Manual call status" value={applied.manual_disposition} options={[...DISPOSITIONS.map(value=>({value,label:dispositionLabel(value)})),{value:"none",label:"No call status"}]} />
  </>;
}

export const REPORTING_FILTER_KEYS = ["added_to_db", "wh_id", "has_notes", "has_manual_calls", "manual_disposition"];

export function AiActivityFilter({applied}:{applied:SearchValues}) {
  return <YesNoFilter name="has_ai_calls" label="AI attempts" applied={applied} yes="At least one recorded attempt" no="No attempts recorded"/>;
}

export function DateFilters({ applied, label = "Date", fromName="date_from", toName="date_to" }: { applied: SearchValues; label?: string; fromName?:string; toName?:string }) {
  return <fieldset className="filter-range"><legend>{label} <span className="muted">· IST</span></legend><div>
    <label><span>From</span><input type="date" name={fromName} aria-label={`${label} from`} defaultValue={firstValue(applied[fromName]) || ""} /></label>
    <label><span>To</span><input type="date" name={toName} aria-label={`${label} to`} defaultValue={firstValue(applied[toName]) || ""} /></label>
  </div></fieldset>;
}

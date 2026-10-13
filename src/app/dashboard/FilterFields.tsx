import { firstValue, type SearchValues } from "@/lib/filter-values";

type Choice = string | { value: string; label: string };
export function SelectFilter({ name, label, applied, options, any = "Any", ariaLabel }: {
  name: string; label: string; applied: SearchValues; options: Choice[]; any?: string; ariaLabel?: string;
}) {
  return <label><span>{label}</span><select name={name} aria-label={ariaLabel || label} defaultValue={firstValue(applied[name]) || ""}>
    <option value="">{any}</option>{options.map(option => {
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
  </>;
}

export const REPORTING_FILTER_KEYS = ["added_to_db", "wh_id", "has_notes", "has_manual_calls"];

export function DateFilters({ applied, label = "Date" }: { applied: SearchValues; label?: string }) {
  return <fieldset className="filter-range"><legend>{label} <span className="muted">· IST</span></legend><div>
    <label><span>From</span><input type="date" name="date_from" aria-label={`${label} from`} defaultValue={firstValue(applied.date_from) || ""} max={firstValue(applied.date_to)} /></label>
    <label><span>To</span><input type="date" name="date_to" aria-label={`${label} to`} defaultValue={firstValue(applied.date_to) || ""} min={firstValue(applied.date_from)} /></label>
  </div></fieldset>;
}

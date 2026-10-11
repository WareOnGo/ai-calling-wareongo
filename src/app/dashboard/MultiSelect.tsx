import { filterValues,type FilterValue } from "@/lib/filter-values";
export function MultiSelect({name,label,value,options,disabled=false}:{name:string;label:string;value:FilterValue;options:(string|{value:string;label:string})[];disabled?:boolean}){
  const selected=filterValues(value),items=options.map(item=>typeof item==="string"?{value:item,label:item}:item);
  for(const value of selected)if(!items.some(item=>item.value===value))items.push({value,label:value});
  return <details className={`filter-multi chip${selected.length?" active":""}`}><summary>{label}{selected.length?` (${selected.length})`:""}</summary><fieldset aria-label={label} className="multi-options" disabled={disabled}>
    <legend>{label} — choose any</legend>{items.map(item=><label key={item.value}><input type="checkbox" name={name} value={item.value} defaultChecked={selected.includes(item.value)}/>{item.label}</label>)}
    {!items.length&&<span className="muted">No options available</span>}
  </fieldset></details>;
}

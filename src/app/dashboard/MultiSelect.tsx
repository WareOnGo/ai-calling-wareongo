"use client";
import { useState } from "react";
import { filterValues,type FilterValue } from "@/lib/filter-values";
export function MultiSelect({name,label,value,options,disabled=false}:{name:string;label:string;value:FilterValue;options:(string|{value:string;label:string})[];disabled?:boolean}){
  const [selected,setSelected]=useState(()=>filterValues(value)),items=options.map(item=>typeof item==="string"?{value:item,label:item}:item);
  for(const value of selected)if(!items.some(item=>item.value===value))items.push({value,label:value});
  const selectionLabel=selected.length>2?`${selected.length} selected`:selected.length?items.filter(item=>selected.includes(item.value)).map(item=>item.label).join(", "):"Any";
  return <div className="filter-choice"><span className="multi-caption" aria-hidden="true">{label}</span><details className={`filter-multi chip${selected.length?" active":""}`}><summary aria-label={`${label}${selected.length?` (${selected.length} selected)`:""}`}><span className="multi-control-label">{label}{selected.length?` (${selected.length})`:""}</span><span className="multi-control-value" aria-hidden="true" title={selectionLabel}>{selectionLabel}</span></summary><fieldset aria-label={label} className="multi-options" disabled={disabled}>
    <legend>{label} — choose any</legend>{items.map(item=><label key={item.value}><input type="checkbox" name={name} value={item.value} checked={selected.includes(item.value)} onChange={event=>setSelected(current=>event.target.checked?[...current,item.value]:current.filter(value=>value!==item.value))}/>{item.label}</label>)}
    {!items.length&&<span className="muted">No options available</span>}
  </fieldset></details></div>;
}

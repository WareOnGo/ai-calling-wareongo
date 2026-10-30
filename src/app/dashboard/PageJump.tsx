"use client";
import { useId, useState } from "react";
import { useDashboardUI } from "./DashboardUI";
export function PageJump({page,pages,param="page",label="Go to page",compact=false}:{page:number;pages:number;param?:string;label?:string;compact?:boolean}){
  const {navigate,pending}=useDashboardUI(),[value,setValue]=useState(String(page)),[error,setError]=useState("");
  const errorId=useId();
  return <form className={`page-jump${compact?' page-jump-compact':''}`} onSubmit={e=>{e.preventDefault();const target=Number(value);
    if(!/^\d+$/.test(value.trim())||!Number.isInteger(target)||target<1||target>pages){setError(`Enter a whole page number from 1 to ${pages}.`);return;}
    setError("");const params=new URLSearchParams(location.search);params.set(param,String(target));navigate(`${location.pathname}?${params}`);
  }}><label>{compact?'Page':label}<input aria-label={label} aria-invalid={!!error} aria-describedby={error?errorId:undefined} inputMode="numeric" value={value} onFocus={e=>e.currentTarget.select()} onChange={e=>{setValue(e.target.value);setError('');}} disabled={pending||pages<=1} size={Math.max(2,String(pages).length)}/>{compact&&<span className="page-total">of {pages.toLocaleString()}</span>}</label><button type="submit" disabled={pending||pages<=1||value===String(page)}>Go</button>{error&&<span role="alert" id={errorId}>{error}</span>}</form>;
}

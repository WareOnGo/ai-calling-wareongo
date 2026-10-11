"use client";
import { useState } from "react";
import { useDashboardUI } from "./DashboardUI";
export function PageJump({page,pages,param="page",label="Go to page"}:{page:number;pages:number;param?:string;label?:string}){
  const {navigate,pending}=useDashboardUI(),[value,setValue]=useState(String(page)),[error,setError]=useState("");
  return <form className="page-jump" onSubmit={e=>{e.preventDefault();const target=Number(value);
    if(!/^\d+$/.test(value.trim())||!Number.isInteger(target)||target<1||target>pages){setError(`Enter a whole page number from 1 to ${pages}.`);return;}
    setError("");const params=new URLSearchParams(location.search);params.set(param,String(target));navigate(`${location.pathname}?${params}`);
  }}><label>{label}<input aria-label={label} inputMode="numeric" value={value} onChange={e=>setValue(e.target.value)} disabled={pending} size={5}/></label><button type="submit" disabled={pending}>Go</button>{error&&<span role="alert">{error}</span>}</form>;
}

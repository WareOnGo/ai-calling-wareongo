"use client";
import { useState } from "react";
import { requestJson } from "./requests";
import { useDashboardUI } from "./DashboardUI";
export function ReopenAssignment({id,revision}:{id:string;revision:number}){
  const {refresh,notify}=useDashboardUI(),[busy,setBusy]=useState(false),[error,setError]=useState("");
  async function reopen(){setBusy(true);setError("");try{await requestJson(`/api/assignments/${id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({state:"open",revision})});notify("Assignment reopened.");refresh();}catch(e){setError(e instanceof Error?e.message:"Couldn't reopen this task");}finally{setBusy(false);}}
  return <><button type="button" className="btn-row" disabled={busy} onClick={reopen}>{busy?"Reopening…":"Reopen"}</button>{error&&<span role="alert">{error}</span>}</>;
}

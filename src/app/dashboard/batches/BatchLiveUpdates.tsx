"use client";
import { useEffect, useRef, useState } from "react";
import { useDashboardUI } from "../DashboardUI";
import { requestJson } from "../requests";

export function BatchLiveUpdates({ids}:{ids:string[]}) {
  const {refresh,pending,hasDrafts}=useDashboardUI();
  const [error,setError]=useState(false),[checking,setChecking]=useState(false);
  const blocked=useRef(pending);blocked.current=pending;
  const key=ids.join(",");
  useEffect(()=>{
    const controller=new AbortController();let busy=false;
    const editing=()=>hasDrafts()||!!document.querySelector('dialog[open], .batch-resolution fieldset')||!!document.activeElement?.matches('input,textarea,select')||!!document.querySelector('.batch-filters.has-changes');
    const tick=async()=>{
      if(busy||document.hidden||blocked.current||editing())return;
      busy=true;setChecking(true);
      try {
        const result=key?await requestJson<{failed:number}>("/api/batches/sync",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({ids:key.split(",")}),signal:controller.signal}):{failed:0};
        if(controller.signal.aborted)return;
        setError(result.failed>0);
        if(!editing())refresh();
      } catch {if(!controller.signal.aborted)setError(true);}
      finally {busy=false;if(!controller.signal.aborted)setChecking(false);}
    };
    const initial=setTimeout(tick,2000),interval=setInterval(tick,30000);
    return()=>{controller.abort();clearTimeout(initial);clearInterval(interval);};
  },[key,refresh,hasDrafts]);
  return <span className={`batch-live${error?' batch-live-error':''}`} role="status">{error?'Status check delayed · will retry':checking?'Checking batch status…':'Live updates · every 30s'}</span>;
}

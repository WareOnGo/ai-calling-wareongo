"use client";
import { useEffect, useRef, useState } from "react";
import { useDashboardUI } from "../DashboardUI";
import { requestJson } from "../requests";

export function BatchLiveUpdates({ids,kind,version,batchId,query}:{ids:string[];kind:'ai'|'manual';version:string;batchId?:string;query:string}) {
  const {refresh,pending,hasDrafts}=useDashboardUI();
  const [error,setError]=useState(false),[syncError,setSyncError]=useState(false),[checking,setChecking]=useState(false);
  const blocked=useRef(pending);
  const key=ids.join(",");
  const renderedVersion=useRef(version);
  useEffect(()=>{blocked.current=pending;renderedVersion.current=version;},[pending,version]);
  useEffect(()=>{
    const controller=new AbortController();let busy=false,syncing=false;
    setError(false);setSyncError(false);
    async function boundedRequest<T>(url:string,init?:RequestInit):Promise<T> {
      const request=new AbortController(),abort=()=>request.abort();
      controller.signal.addEventListener('abort',abort,{once:true});
      if(controller.signal.aborted)abort();
      const timer=setTimeout(abort,15_000);
      try { return await requestJson<T>(url,{...init,signal:request.signal}); }
      finally { clearTimeout(timer);controller.signal.removeEventListener('abort',abort); }
    }
    const editing=()=>hasDrafts()||!!document.querySelector('dialog[open], .batch-resolution fieldset')||!!document.activeElement?.matches('input,textarea,select')||!!document.querySelector('.filterbar.has-changes');
    const tick=async()=>{
      if(busy||document.hidden||blocked.current||editing())return;
      busy=true;setChecking(true);
      try {
        // Reconciliation runs after the API response. Reading committed status
        // must remain independent of a slow provider or a stuck sync request.
        if(key&&!syncing) {
          syncing=true;
          void boundedRequest<{failed?:number}>("/api/batches/sync",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({ids:key.split(","),background:true})})
            .then(result=>{if(!controller.signal.aborted)setSyncError(!!result.failed);})
            .catch(()=>{if(!controller.signal.aborted)setSyncError(true);})
            .finally(()=>{syncing=false;});
        }
        const params=new URLSearchParams(query);
        params.set('kind',kind);params.delete('id');
        if(batchId)params.set('id',batchId);
        const result=await boundedRequest<{version:string}>(`/api/batches/version?${params}`,{cache:'no-store'});
        if(controller.signal.aborted)return;
        setError(false);
        if(result.version!==renderedVersion.current&&!blocked.current&&!editing())refresh();
      } catch {if(!controller.signal.aborted)setError(true);}
      finally {busy=false;if(!controller.signal.aborted)setChecking(false);}
    };
    // A completed/manual page has just fetched its data. Do not repeat that
    // entire render two seconds later; the regular live refresh still applies.
    const initial=key?setTimeout(tick,2000):null,interval=setInterval(tick,30000);
    return()=>{controller.abort();if(initial)clearTimeout(initial);clearInterval(interval);};
  },[key,kind,batchId,query,refresh,hasDrafts]);
  const delayed=error||syncError;
  return <span className={`batch-live${delayed?' batch-live-error':''}`} role="status">{delayed?'Status check delayed · will retry':checking?'Checking batch status…':'Live updates · every 30s'}</span>;
}

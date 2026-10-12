"use client";
import {useEffect,useState} from 'react';
import {Dialog} from './Dialog';
import {dateTime} from '@/lib/display';
import {elapsedTime} from '@/lib/time';
import {agentLabel} from '@/lib/agents';
import type {AiHistory} from '@/lib/ai-attempts';
import {requestJson} from './requests';
import {useDashboardUI} from './DashboardUI';
export function AiTimeline({entity,id,initialOpen=false,initialBatch="",initialScope}:{initialBatch?:string;initialScope?:"contact"|"execution";entity:'record'|'call';id:string;initialOpen?:boolean}){
 const {isAdmin}=useDashboardUI();
 const [open,setOpen]=useState(initialOpen),[scope,setScope]=useState(initialScope||(entity==='record'?'contact':'execution')),[batch,setBatch]=useState(initialBatch),[draft,setDraft]=useState(initialBatch);
 const [page,setPage]=useState(1),[data,setData]=useState<AiHistory|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{
  if(!open)return;const controller=new AbortController();setData(null);setError('');
  const params=new URLSearchParams({scope,batch,page:String(page)});
  requestJson<AiHistory>(`/api/details/${entity}/${id}/ai?${params}`,{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setData(value);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
  return()=>controller.abort();
 },[entity,id,scope,batch,page,open,retry]);
 return <section className="ai-timeline"><h3>AI attempt history</h3>
  {!open?<button type="button" className="btn-row" onClick={()=>setOpen(true)}>Load AI attempt history</button>:<>
   <div className="history-filters">{entity==='call'&&isAdmin&&<label>History scope <select aria-label="AI history scope" value={scope} onChange={e=>{setScope(e.target.value==="contact"?"contact":"execution");setPage(1);}}><option value="execution">This execution</option><option value="contact">All calls for this contact</option></select></label>}
   <label>Provider batch <input aria-label="AI history batch" value={draft} onChange={e=>setDraft(e.target.value)} placeholder="All batches" maxLength={1000}/></label><button type="button" className="btn-row" onClick={()=>{setBatch(draft);setPage(1);}}>Filter AI history</button></div>
   {error?<p role="alert">{error} <button type="button" onClick={()=>setRetry(n=>n+1)}>Retry AI history</button></p>:!data?<p role="status">Loading AI attempts…</p>:<>
    <div className="history-summary"><div><strong>{data.total}</strong> known attempts</div><div><strong>{data.outbound}</strong> outbound · {data.inbound} inbound</div><div><strong>{data.conversations}</strong> confirmed conversations</div></div>
    <p className="history-scope">Scope: {data.scope==='contact'?'all matching contact numbers':'this execution'}{data.batch?` · batch ${data.batch}`:''} · {data.contacts} contacts.</p>
    {data.unknownExecutions > 0 && <p className="history-note">{data.unknownExecutions} execution records have no identifiable provider attempt.</p>}
    <div className="attempt-list">{data.rows.length?data.rows.map(event=><article className="attempt-card" key={`${event.execution_id}:${event.provider_call_id}`}>
     <div className="attempt-heading"><strong>{event.initiated_at?`Dial started: ${dateTime(event.initiated_at)}`:'Dial start time unknown'}</strong><span className="pill">{event.status||'Unknown status'}</span></div>
     <p className="attempt-contact">{event.direction||'Unknown direction'} · {event.phone_last10||'Number unavailable'} · {agentLabel(event.agent_id)}</p>
     <div className="attempt-outcome"><span>{event.duration_seconds!==null?`Provider duration: ${event.duration_seconds}s`:'Duration unknown'}</span><span>{event.confirmed_conversation?'Confirmed conversation':'Conversation not confirmed'}</span></div>
     <p className="attempt-interval">{event.interval_seconds!==null?`${elapsedTime(Number(event.interval_seconds))} since the previous dated attempt for this phone/direction`:'Interval unavailable'}</p>
     <details className="evidence-details"><summary>Provider details</summary><p>Execution created: {dateTime(event.execution_created_at)}<br/>First observed: {dateTime(event.first_observed_at)}</p><p>Provider call: {event.provider_call_id}<br/>Batch: {event.batch_id||'Not supplied'}</p></details>
    </article>):<p className="history-empty">No identifiable provider attempts in this history.</p>}</div>
    {data.pages>1&&<nav aria-label="AI attempt pages"><button type="button" disabled={data.page<=1} onClick={()=>setPage(p=>p-1)}>Previous AI attempts</button><span> {data.page}/{data.pages} </span><button type="button" disabled={data.page>=data.pages} onClick={()=>setPage(p=>p+1)}>Next AI attempts</button></nav>}
   </>}
   <details className="evidence-details history-about"><summary>About this history</summary><p>Known provider calls only. Older overwritten attempts and missing provider IDs cannot be reconstructed from totals. Inbound calls are shown separately.</p><p>Conversation counts require finalized duration and caller speech evidence.</p></details>
  </>}
 </section>;
}

export function AiHistoryButton({entity,id,name,executionCount}:{entity:'call'|'record';id:string;name?:string|null;executionCount?:number}){
 const [open,setOpen]=useState(false);
 return <div className="inline-ai-history">
  <button className="btn-row" type="button" aria-haspopup="dialog" onClick={()=>setOpen(true)}>Show AI attempts</button>
  {open&&<Dialog title="AI attempt history" drawer wide onClose={()=>setOpen(false)}>
    <div className="modal-body ai-history-panel">{name&&<p className="history-record-name">{name}</p>}{executionCount!==undefined&&<p className="history-scope">{executionCount} execution records</p>}<AiTimeline entity={entity} id={id} initialOpen/></div>
    <div className="modal-foot"><button className="btn secondary" type="button" onClick={()=>setOpen(false)}>Close AI history</button></div>
  </Dialog>}
 </div>;
}

"use client";
import {useEffect,useState,useRef} from 'react';
import {createPortal} from 'react-dom';
import {dateTime} from '@/lib/display';
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
   <p>Known provider calls only. Older overwritten attempts and missing provider IDs cannot be reconstructed from totals. Inbound calls are shown separately.</p>
   {entity==='call'&&isAdmin&&<label>History scope <select aria-label="AI history scope" value={scope} onChange={e=>{setScope(e.target.value==="contact"?"contact":"execution");setPage(1);}}><option value="execution">This execution</option><option value="contact">All calls for this contact</option></select></label>}
   <label>Provider batch <input aria-label="AI history batch" value={draft} onChange={e=>setDraft(e.target.value)} placeholder="All batches" maxLength={1000}/></label><button type="button" className="btn-row" onClick={()=>{setBatch(draft);setPage(1);}}>Filter AI history</button>
   {error?<p role="alert">{error} <button type="button" onClick={()=>setRetry(n=>n+1)}>Retry AI history</button></p>:!data?<p role="status">Loading AI attempts…</p>:<>
    <p><strong>{data.total} known attempts</strong> · {data.outbound} outbound · {data.inbound} inbound · {data.contacts} contacts · {data.conversations} confirmed conversations</p>
    <p className="muted">Scope: {data.scope==='contact'?'all matching contact numbers':'this execution'}{data.batch?` · batch ${data.batch}`:''}. {data.unknownExecutions} execution records have no identifiable provider attempt. Conversation counts require finalized duration and caller speech evidence.</p>
    {data.rows.length?data.rows.map(event=><div className="detail-history" key={`${event.execution_id}:${event.provider_call_id}`}>
     <strong>{event.initiated_at?`Dial started: ${dateTime(event.initiated_at)}`:event.provider_initiated_at?`Provider dial time: ${event.provider_initiated_at} (timezone not supplied)`:'Dial start time unknown'}</strong> · {event.status||'Unknown status'}
     <p>{event.direction||'Unknown direction'} · {event.phone_last10||'Number unavailable'} · {agentLabel(event.agent_id)}</p>
     <p>{event.duration_seconds!==null?`Provider duration: ${event.duration_seconds}s`:'Duration unknown'} · {event.confirmed_conversation?'Confirmed conversation':'Conversation not confirmed'}</p>
     <p>{event.interval_seconds!==null?`${Number(event.interval_seconds).toLocaleString('en-IN')} seconds since the previous dated attempt for this phone/direction${event.clock_basis==='provider_local'?' · provider clock; timezone not supplied':''}`:'Interval unavailable'}</p>
     <small>Execution created: {dateTime(event.execution_created_at)} · First observed: {dateTime(event.first_observed_at)}<br/>Provider call: {event.provider_call_id} · Batch: {event.batch_id||'Not supplied'}</small>
    </div>):<p>No identifiable provider attempts in this history.</p>}
    {data.pages>1&&<nav aria-label="AI attempt pages"><button type="button" disabled={data.page<=1} onClick={()=>setPage(p=>p-1)}>Previous AI attempts</button><span> {data.page}/{data.pages} </span><button type="button" disabled={data.page>=data.pages} onClick={()=>setPage(p=>p+1)}>Next AI attempts</button></nav>}
   </>}
  </>}
 </section>;
}

export function InlineAiTimeline({entity,id}:{entity:'call'|'record';id:string}){
 const [open,setOpen]=useState(false),[host,setHost]=useState<HTMLTableCellElement|null>(null);
 const anchor=useRef<HTMLDivElement>(null),{pending}=useDashboardUI();
 const historyId=`ai-history-${entity}-${id}`;
 useEffect(()=>{
  if(!open||pending)return;
  const row=anchor.current?.closest('tr');if(!row)return;
  // A spanning sibling row keeps history readable without widening every column.
  const detail=document.createElement('tr'),cell=document.createElement('td');
  detail.className='ai-history-row';cell.colSpan=row.cells.length;cell.id=historyId;
  detail.append(cell);row.after(detail);setHost(cell);
  return()=>{setHost(null);detail.remove();};
 },[open,pending,historyId]);
 return <div ref={anchor} className="inline-ai-history">
  <button className="btn-row" type="button" aria-expanded={open} aria-controls={open?historyId:undefined} onClick={()=>setOpen(v=>!v)}>{open?'Hide AI attempts':'Show AI attempts'}</button>
  {open&&host&&createPortal(<div className="ai-history-panel"><button className="btn-row" type="button" onClick={()=>setOpen(false)}>Close AI history</button><AiTimeline entity={entity} id={id} initialOpen/></div>,host)}
 </div>;
}

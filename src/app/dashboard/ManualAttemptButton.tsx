"use client";
import { useEffect, useState } from "react";
import { DISPOSITIONS,DISPOSITION_LABELS,RETRY_DISPOSITIONS,type Disposition } from "@/lib/manual-dispositions";
import type { ManualAttempt } from "@/lib/manual-attempts";
import { Dialog } from "./Dialog";
import { requestJson } from "./requests";
import { useDashboardUI } from "./DashboardUI";
const localIST=(date:Date)=>date.toLocaleString("sv-SE",{timeZone:"Asia/Kolkata"}).replace(" ","T").slice(0,16);
export function ManualAttemptButton({assignmentId,revision,disabled=false}:{assignmentId:string;revision:number;disabled?:boolean}){
  const {refresh,notify,pending}=useDashboardUI();
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [id,setId]=useState(""),[at,setAt]=useState(""),[due,setDue]=useState(""),[duration,setDuration]=useState("");
  const [disposition,setDisposition]=useState<Disposition>("connected"),[outcome,setOutcome]=useState("");
  const [notes,setNotes]=useState(""),[corrects,setCorrects]=useState("");
  const [events,setEvents]=useState<ManualAttempt[]>([]);
  const [historyLoading,setHistoryLoading]=useState(false),[historyError,setHistoryError]=useState(""),[historyRetry,setHistoryRetry]=useState(0);
  useEffect(()=>{
    if(!open)return;
    const controller=new AbortController();setHistoryLoading(true);setHistoryError("");
    requestJson<{rows:ManualAttempt[]}>(`/api/assignments/${assignmentId}/attempts`,{signal:controller.signal})
      .then(data=>{if(!controller.signal.aborted)setEvents(data.rows);})
      .catch(()=>{if(!controller.signal.aborted)setHistoryError("Couldn't load recent call history. You can still record a new attempt; retry to correct a previous call.");})
      .finally(()=>{if(!controller.signal.aborted)setHistoryLoading(false);});
    return()=>controller.abort();
  },[open,assignmentId,historyRetry]);
  function resetAttempt(){
    setId(crypto.randomUUID());setAt(localIST(new Date()));setDue("");setDuration("");setDisposition("connected");setOutcome("");setNotes("");setCorrects("");setError("");
  }
  function show(){
    resetAttempt();setEvents([]);setHistoryError("");setOpen(true);
  }
  function correction(key:string){
    const event=events.find(e=>e.id===key);if(!event){resetAttempt();return;}
    setCorrects(key);setId(crypto.randomUUID());setError("");
    setAt(localIST(new Date(event.occurred_at)));setDisposition(event.disposition as Disposition);setOutcome(event.outcome||"");
    setDue(event.next_due_at?localIST(new Date(event.next_due_at)):"");setDuration(event.duration_seconds===null?"":String(event.duration_seconds));setNotes("");
  }
  async function save(){
    setBusy(true);setError("");
    try{
      await requestJson(`/api/assignments/${assignmentId}/attempts`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id,revision,
        occurred_at:new Date(`${at}:00+05:30`).toISOString(),disposition,...(outcome?{outcome}:{}),notes,
        next_due_at:due?new Date(`${due}:00+05:30`).toISOString():null,duration_seconds:duration===""?null:Number(duration),...(corrects?{corrects_id:corrects}:{})})});
      setOpen(false);notify(corrects?"Correction recorded; the original remains in history.":"Manual attempt recorded.");refresh();
    }catch(e){setError(e instanceof Error?e.message:"Couldn't record the attempt");}
    finally{setBusy(false);}
  }
  return <><button type="button" className="btn-row" disabled={disabled||pending} title={disabled||pending?"Save pending changes or reopen the task first":"Record a call you made"} onClick={show}>Log manual call</button>
    {open&&<Dialog title="Log manual call" onClose={()=>setOpen(false)} busy={busy}><form className="manual-attempt-form" onSubmit={e=>{e.preventDefault();void save();}}>
      <div className="modal-body"><p>Record an actual calling attempt. Notes edits do not count as calls. All times below are in India (IST).</p>
        {historyLoading&&<p role="status">Loading recent call history…</p>}
        {historyError&&<p role="alert" className="assign-error">{historyError} <button type="button" className="btn-row" disabled={historyLoading||busy} onClick={()=>setHistoryRetry(n=>n+1)}>Retry history</button></p>}
        <fieldset className="plain-fieldset" disabled={busy}>
          {!!events.length&&<label className="assign-field"><span>Event</span><select value={corrects} onChange={e=>correction(e.target.value)}><option value="">New attempt</option>{events.map(event=><option key={event.id} value={event.id}>Correct {localIST(new Date(event.occurred_at)).replace("T"," ")} · {DISPOSITION_LABELS[event.disposition as Disposition]}</option>)}</select></label>}
          <label className="assign-field"><span>Attempt time (IST)</span><input type="datetime-local" required value={at} onChange={e=>{setAt(e.target.value);setId(crypto.randomUUID());}}/></label>
          <label className="assign-field"><span>What happened?</span><select value={disposition} onChange={e=>{setDisposition(e.target.value as Disposition);if(!RETRY_DISPOSITIONS.includes(e.target.value))setDue("");setId(crypto.randomUUID());}}>{DISPOSITIONS.map(d=><option key={d} value={d}>{DISPOSITION_LABELS[d]}</option>)}</select></label>
          <label className="assign-field"><span>Manual result</span><select className="outcome-select" data-result={outcome||undefined} value={outcome} onChange={e=>{setOutcome(e.target.value);setId(crypto.randomUUID());}}><option value="">Keep existing result</option>{["Available","Unavailable","Unclear"].map(v=><option key={v}>{v}</option>)}</select></label>
          <label className="assign-field"><span>Next follow-up (IST)</span><input type="datetime-local" disabled={!RETRY_DISPOSITIONS.includes(disposition)} required={disposition==="callback"||disposition==="awaiting_confirmation"} value={due} onChange={e=>{setDue(e.target.value);setId(crypto.randomUUID());}}/></label>
          <label className="assign-field"><span>Reported duration (seconds, optional)</span><input type="number" min="0" max="86400" step="1" value={duration} onChange={e=>{setDuration(e.target.value);setId(crypto.randomUUID());}}/></label>
          <label className="assign-field"><span>{corrects?"Why is this correction needed?":"Attempt notes"}</span><textarea value={notes} required={!!corrects} minLength={corrects?10:undefined} onChange={e=>{setNotes(e.target.value);setId(crypto.randomUUID());}}/></label>
        </fieldset>{error&&<p role="alert" className="assign-error">{error}</p>}</div>
      <div className="modal-foot"><button type="button" className="btn-text" disabled={busy} onClick={()=>setOpen(false)}>Cancel</button><button type="submit" className="btn-primary" disabled={busy}>{busy?"Saving…":corrects?"Save correction":"Record attempt"}</button></div>
    </form></Dialog>}
  </>;
}

"use client";
import { useEffect,useRef,useState } from "react";
import { useDashboardUI } from "./DashboardUI";
import { ManualAttemptDialog } from "./ManualAttemptButton";
import { DISPOSITION_LABELS,RETRY_DISPOSITIONS,type Disposition } from "@/lib/manual-dispositions";
import { dateTime } from "@/lib/display";
import { OUTCOMES } from "@/lib/scope";
import { IconCheck } from "./icons";
import { useAutosave, SaveStatus } from "./useAutosave";

type Props = { revision: number; assignmentId: string; outcome: string | null; remarks: string | null; addedToDb: boolean; whId: string | null; state?: string; closureReason?:string|null; disposition?:string|null; nextDueAt?:string|null; onStateChange?: (id: string, state: string) => void };
export function OutcomeCells({ revision, assignmentId, outcome, remarks, addedToDb, whId, state = "open", closureReason,disposition,nextDueAt,onStateChange }: Props) {
  const { pending:pagePending,refresh } = useDashboardUI();
  const [awaitingRevision,setAwaitingRevision]=useState(0);
  // A transition can end before its streamed row arrives. Never reuse the
  // pre-call revision for an immediate result edit or a second call.
  const callPending=revision<awaitingRevision;
  const pending=pagePending||callPending;
  const key = `assignment-${assignmentId}`;
  const save = useAutosave(key, `/api/assignments/${assignmentId}`, { outcome: outcome ?? "", remarks: remarks ?? "", added_to_db: addedToDb, wh_id: whId ?? "", state,closure_reason:closureReason??"" }, ["outcome", "added_to_db", "state","closure_reason"], revision,["outcome","closure_reason"]);
  const whInput=useRef<HTMLInputElement>(null),notesInput=useRef<HTMLTextAreaElement>(null);
  const focusedError=useRef('');
  useEffect(()=>{
    if(!save.dirty){focusedError.current='';return;}
    const key=`${save.field}:${save.error}`;
    if(save.status==='error'&&focusedError.current!==key){
      focusedError.current=key;
      if(save.field==='wh_id')whInput.current?.focus();else if(save.field==='remarks')notesInput.current?.focus();
    }
  },[save.status,save.field,save.error,save.dirty]);
  const done = save.values.state === "done";
  const [callIntent,setCallIntent]=useState<"log"|"complete"|null>(null);
  const [queuedCall,setQueuedCall]=useState<"log"|"complete"|null>(null);
  // A WH ID may still be saving from blur when the caller clicks Mark done.
  // Wait for its confirmed revision before opening the call form.
  useEffect(()=>{
    if(!queuedCall)return;
    if(save.status==='error'){setQueuedCall(null);return;}
    if(!save.dirty&&!pending){setCallIntent(queuedCall);setQueuedCall(null);}
  },[queuedCall,save.status,save.dirty,pending]);
  function logCall(intent:"log"|"complete"){
    if(save.dirty){setQueuedCall(intent);void save.flush();}
    else setCallIntent(intent);
  }
  const needsFollowUp=!!disposition&&RETRY_DISPOSITIONS.includes(disposition);
  const needsCall=!disposition || needsFollowUp&&save.values.closure_reason!=="exhausted";
  useEffect(() => { onStateChange?.(assignmentId, save.values.state); }, [assignmentId, save.values.state, onStateChange]);
  const cls = save.status === "saving" ? "saving" : save.status === "error" ? "err" : save.status === "saved" ? "ok" : "";
  return <>
    <td className={`edit-cell edit-first ${cls}`}><select disabled={pending} className="field field-select" aria-label="Result of the call" value={save.values.outcome} onChange={e => save.set("outcome", e.target.value, true)}><option value="">No manual result</option>{OUTCOMES.map(o => <option key={o}>{o}</option>)}</select></td>
    <td className={`edit-cell notes-cell ${cls}`}><textarea disabled={pending} ref={notesInput} className="field notes-field" aria-label="Your notes" rows={2} value={save.values.remarks} placeholder="What did they say?" onChange={e => save.set("remarks", e.target.value)} onBlur={save.flush} />
      {(save.values.outcome==="Unclear"||disposition==="invalid_number"||needsFollowUp||save.values.closure_reason==="exhausted")&&<select disabled={pending} className="field" aria-label="Closure reason" value={save.values.closure_reason} onChange={e=>save.set("closure_reason",e.target.value,true)}><option value="">{needsFollowUp?"Keep open for follow-up":"Choose closure reason…"}</option>{!needsFollowUp&&<><option value="resolved">No further action — explained in notes</option><option value="escalated">Escalated to an admin — explained in notes</option><option value="invalid_number_verified">Number verified invalid — evidence in notes</option></>}{(needsFollowUp||save.values.closure_reason==='exhausted')&&<option value="exhausted">Exhausted follow-ups — explain why in notes</option>}</select>}
      {disposition&&<p>Last logged call: {DISPOSITION_LABELS[disposition as Disposition]||disposition}{nextDueAt&&<> · Due {dateTime(nextDueAt)}</>}</p>}
      {!done&&needsFollowUp&&save.values.closure_reason!=="exhausted"&&<p className="muted">{save.values.outcome?`Saved result: ${save.values.outcome}. `:""}Log the next conversation before completing, or correct the last call if it was entered incorrectly.</p>}
      <SaveStatus id={key} {...save} /><button type="button" className="btn-row" disabled={pending||done||save.status==='error'} title={done?"Reopen this task to record another call":"Record a call you made"} onClick={()=>logCall("log")}>Log manual call</button>
      {callPending&&<p role="status">Call saved. Waiting for the updated task. <button type="button" className="btn-row" disabled={pagePending} onClick={refresh}>Refresh task</button></p>}
      {callIntent&&<ManualAttemptDialog assignmentId={assignmentId} revision={save.revision} intent={callIntent} onClose={()=>setCallIntent(null)} onRecorded={setAwaitingRevision} existingOutcome={save.values.outcome} existingWhId={save.values.wh_id} existingRemarks={save.values.remarks} existingAddedToDb={save.values.added_to_db} lastDisposition={disposition}/>}</td>
    <td className={`edit-cell center ${cls}`}><label className="checkfield" title="Your verification: this warehouse is in the database"><input disabled={pending} type="checkbox" checked={save.values.added_to_db} onChange={e => save.set("added_to_db", e.target.checked, true)} /><span>{save.values.added_to_db ? "Added" : "Not yet"}</span></label></td>
    <td className={`edit-cell ${cls}`}><input disabled={pending} ref={whInput} className="field field-narrow" aria-label="Warehouse ID" inputMode="numeric" pattern="[1-9][0-9]*" value={save.values.wh_id} placeholder="WH ID" onChange={e => save.set("wh_id", e.target.value)} onBlur={save.flush} /></td>
    <td className={`edit-cell ${cls}`}><button type="button" disabled={pending||!!queuedCall} className={`btn-done${done ? " is-done" : ""}`} aria-pressed={done} onClick={() => !done&&needsCall ? logCall("complete") : save.set("state", done ? "open" : "done", true)} title={done ? "Reopen this one" : needsCall ? "Record or correct the call, then complete this task" : "Mark finished — it stays visible"}><IconCheck size={14} />{done ? "Done" : "Mark done"}</button>{!done&&needsCall&&<small className="completion-hint">{queuedCall?"Saving your edits…":"Opens call logging"}</small>}{done&&<small className="completion-hint">Click to reopen</small>}</td>
  </>;
}

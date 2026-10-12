import { z } from "zod";
import { query,transaction } from "./db";
import { ApiError,uuid,revision } from "./api";
import { CLOSURE_REASONS,DISPOSITIONS,RETRY_DISPOSITIONS } from "./manual-dispositions";
import { allocationHash } from "./assignment-allocation";
import type { Viewer,EntityType } from "./scope";
export const manualAttemptSchema=z.object({
  id:uuid,revision,occurred_at:z.string().datetime({offset:true}),disposition:z.enum(DISPOSITIONS),
  outcome:z.enum(["Available","Unavailable","Unclear"]).nullable().optional(),
  notes:z.string().trim().max(10000).optional(),next_due_at:z.string().datetime({offset:true}).nullable().optional(),
  duration_seconds:z.number().int().min(0).max(86400).nullable().optional(),corrects_id:uuid.optional(),
  // The caller can record a conversation and finish its task in one transaction.
  // Omission keeps the task open and leaves its verification fields unchanged.
  completion:z.object({
    wh_id:z.string().trim().max(100).nullable().optional(),
    added_to_db:z.boolean().optional(),
    remarks:z.string().trim().max(10000).nullable().optional(),
    closure_reason:z.enum(CLOSURE_REASONS).nullable().optional(),
  }).strict().optional(),
}).strict().refine(v=>!["callback","awaiting_confirmation"].includes(v.disposition)||!!v.next_due_at,"Choose a follow-up time for callback or awaiting confirmation")
 .refine(v=>!v.next_due_at||RETRY_DISPOSITIONS.includes(v.disposition),"Choose a retry or callback disposition when scheduling follow-up")
 .refine(v=>!v.next_due_at||Date.parse(v.next_due_at)>=Date.parse(v.occurred_at),"Follow-up time cannot precede the attempt");
export type ManualAttemptInput=z.infer<typeof manualAttemptSchema>;
export async function recordManualAttempt(assignmentId:string,user:Viewer,input:ManualAttemptInput){
  const body=manualAttemptSchema.parse(input),hash=allocationHash({assignmentId,...body,revision:undefined});
  if(Date.parse(body.occurred_at)>Date.now()+300000)throw new ApiError(400,"The attempt time cannot be in the future");
  return transaction(async client=>{
    await client.query("select set_config('bolna.actor',$1,true)",[user.email.toLowerCase()]);
    const assignment=(await client.query(`select * from bolna_assignments where id=$1 and state='open'
      and ($2::boolean or assignee=$3) for update`,[assignmentId,user.isAdmin,user.email.toLowerCase()])).rows[0];
    const prior=(await client.query("select request_hash,actor from bolna_manual_attempts where id=$1",[body.id])).rows[0];
    if(prior){if(prior.actor!==user.email.toLowerCase()||prior.request_hash!==hash)throw new ApiError(409,"This attempt key was already used for another event");return {id:body.id,replayed:true};}
    if(!assignment || assignment.revision!==body.revision)throw new ApiError(409,"Assignment changed or is no longer editable. Refresh before recording the attempt.");
    if(Date.parse(body.occurred_at)<Date.parse(assignment.assigned_at)-300000)throw new ApiError(400,"Attempt time cannot precede this assignment");
    let recordedOutcome=body.outcome??null;
    if(body.corrects_id){
      const previous=(await client.query("select id,outcome from bolna_effective_manual_attempts where id=$1 and assignment_id=$2",[body.corrects_id,assignmentId])).rows[0];
      if(!previous)throw new ApiError(409,"That event has already been corrected or belongs to another assignment");
      if(!body.notes||body.notes.length<10)throw new ApiError(400,"Explain the correction in at least 10 characters");
      // Keep existing result also retains the corrected event's result, so its
      // replacement remains the source for later corrections and reporting.
      recordedOutcome=body.outcome??previous.outcome;
    }
    await client.query(`insert into bolna_manual_attempts(id,assignment_id,actor,assignee,occurred_at,disposition,outcome,notes,next_due_at,duration_seconds,corrects_id,request_hash)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[body.id,assignmentId,user.email.toLowerCase(),assignment.assignee,body.occurred_at,body.disposition,recordedOutcome,body.notes||null,body.next_due_at??null,body.duration_seconds??null,body.corrects_id??null,hash]);
    const latest=(await client.query("select * from bolna_effective_manual_attempts where assignment_id=$1 order by occurred_at desc,created_at desc,id desc limit 1",[assignmentId])).rows[0];
    const effectiveResult=(await client.query("select id,outcome from bolna_effective_manual_attempts where assignment_id=$1 and outcome is not null order by occurred_at desc,created_at desc,id desc limit 1",[assignmentId])).rows[0];
    // Null means Keep existing result. Only an explicit newest result or a
    // correction to the event currently supplying that result changes it. A
    // correction of the latest call can replace an inherited attempt result or
    // fill an unknown result, while preserving an independent dropdown choice.
    const replaceResult=(!body.corrects_id && !!body.outcome && effectiveResult?.id===body.id)
      || (!!body.corrects_id && (assignment.outcome_attempt_id===body.corrects_id
        || (assignment.outcome===null || assignment.outcome_attempt_id!==null) && latest.id===body.id && !!body.outcome));
    const outcome=replaceResult ? effectiveResult?.outcome ?? null : assignment.outcome;
    const outcomeAttemptId=replaceResult ? effectiveResult?.id ?? null : assignment.outcome_attempt_id;
    const state=body.completion?'done':'open';
    const whId=body.completion && 'wh_id' in body.completion ? body.completion.wh_id || null : assignment.wh_id;
    const remarks=body.completion && 'remarks' in body.completion ? body.completion.remarks || null : assignment.remarks;
    const closureReason=body.completion?.closure_reason??null;
    if(body.completion){
      const issue=(await client.query("select bolna_completion_issue($1,$2,$3,$4,$5,$6) issue",
        [assignmentId,state,outcome,whId,remarks,closureReason])).rows[0].issue;
      if(issue)throw new ApiError(422,issue.message,issue.code,issue.field);
    }
    await client.query(`update bolna_assignments set disposition=$2,last_attempt_at=$3,next_due_at=$4,
      outcome=$5,outcome_attempt_id=$6,state=$7,wh_id=$8,remarks=$9,closure_reason=$10,added_to_db=$11,
      completed_at=case when $7='done' then now() else null end,revision=revision+1 where id=$1`,
      [assignmentId,latest.disposition,latest.occurred_at,RETRY_DISPOSITIONS.includes(latest.disposition)?latest.next_due_at:null,
        outcome,outcomeAttemptId,state,whId,remarks,closureReason,body.completion?.added_to_db??assignment.added_to_db]);
    return {id:body.id,replayed:false};
  });
}
export type ManualAttempt={id:string;assignment_id:string;actor:string;assignee:string;occurred_at:string;created_at:string;disposition:string;outcome:string|null;notes:string|null;next_due_at:string|null;duration_seconds:number|null;corrects_id:string|null;superseded:boolean};
/** Evidence stays within the viewer's assignment episodes, even after another owner takes over. */
export async function manualHistory(viewer:Viewer,entity:EntityType,id:string,page=1){
  const values=[entity,id,viewer.isAdmin,viewer.email.toLowerCase()];
  const from=`from bolna_manual_attempts e join bolna_assignments a on a.id=e.assignment_id where a.entity_type=$1 and a.entity_id=$2 and ($3::boolean or a.assignee=$4 and a.state<>'dropped')`;
  const total=Number((await query(`select count(*) n ${from}`,values)).rows[0].n);
  const current=Math.min(Math.max(1,Math.floor(page)||1),Math.max(1,Math.ceil(total/50)));
  const rows=(await query<ManualAttempt>(`select e.*,e.assignment_id::text,exists(select 1 from bolna_manual_attempts c where c.corrects_id=e.id) as superseded ${from} order by e.occurred_at desc,e.created_at desc,e.id desc limit 50 offset ${(current-1)*50}`,values)).rows;
  return {rows,total,page:current,pages:Math.max(1,Math.ceil(total/50))};
}

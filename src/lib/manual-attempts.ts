import { z } from "zod";
import { query,transaction } from "./db";
import { ApiError,uuid,revision } from "./api";
import { DISPOSITIONS,RETRY_DISPOSITIONS } from "./manual-dispositions";
import { allocationHash } from "./assignment-allocation";
import { assignmentScope, type Viewer, type EntityType } from "./scope";
import { callyzerAccount, normalizeContactNumber } from "./callyzer";
export const manualAttemptSchema=z.object({
  id:uuid,revision,occurred_at:z.string().datetime({offset:true}),disposition:z.enum(DISPOSITIONS),
  outcome:z.enum(["Available","Unavailable","Unclear"]).nullable().optional(),
  notes:z.string().trim().max(10000).optional(),next_due_at:z.string().datetime({offset:true}).nullable().optional(),
  duration_seconds:z.number().int().min(0).max(86400).nullable().optional(),corrects_id:uuid.optional(),
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
    await client.query(`update bolna_assignments set disposition=$2,last_attempt_at=$3,next_due_at=$4,
      outcome=$5,outcome_attempt_id=$6,closure_reason=null,revision=revision+1 where id=$1`,
      [assignmentId,latest.disposition,latest.occurred_at,RETRY_DISPOSITIONS.includes(latest.disposition)?latest.next_due_at:null,outcome,outcomeAttemptId]);
    return {id:body.id,replayed:false};
  });
}
export type ManualAttempt={id:string;assignment_id:string;actor:string;assignee:string;occurred_at:string;created_at:string;disposition:string;outcome:string|null;notes:string|null;next_due_at:string|null;duration_seconds:number|null;corrects_id:string|null;superseded:boolean};
export type ImportedManualCall = {
  source: "callyzer"; id: string; occurred_at: string; assignee: string | null; caller_name: string | null;
  employee_number: string; client_number: string | null; duration_seconds: number | null;
  call_type: "Incoming" | "Outgoing" | "Missed" | "Rejected"; call_method: string; call_mode: string;
  provider_synced_at: string | null; superseded: false; corrects_id: null;
};
export type ManualHistoryEvent = (ManualAttempt & {source:"manual"}) | ImportedManualCall;
export type ManualCallHistory = { rows: ManualHistoryEvent[]; total: number; logged: number; imported: number; page: number; pages: number };

/** Staff logs retain their entity scope. Imported calls match full contact numbers;
 * employees can only see their own calls on entities they are allowed to read. */
export async function manualHistory(viewer:Viewer,entity:EntityType,id:string,page=1):Promise<ManualCallHistory>{
  const phoneParams:unknown[]=[id], scope=assignmentScope(viewer,entity,"seed.id",phoneParams);
  const contactPhones=(await query<{phone:string|null}>(entity === "record" ?
    `select coalesce(nullif(trim(p.phone),''),p.phone_last10) phone from raw_records seed
      join raw_phones rp on rp.master_id=seed.id join raw_phone_numbers p using(phone_id)
      where seed.id=$1::uuid${scope ? ` and ${scope}` : ''}` :
    `select case when seed.call_type='inbound' then seed.from_number else seed.to_number end phone
      from bolna_call_logs seed where seed.id=$1::uuid${scope ? ` and ${scope}` : ''}`,phoneParams)).rows;
  const phones=[...new Set(contactPhones.map(row=>normalizeContactNumber(row.phone)).filter((phone):phone is string=>!!phone))];
  const values:unknown[]=[entity,id,viewer.isAdmin,viewer.email.toLowerCase(),callyzerAccount(),phones];
  const events=`with events as (
    select 'manual' source,e.id::text id,e.occurred_at,e.created_at,
      jsonb_build_object('source','manual','id',e.id,'assignment_id',e.assignment_id::text,'actor',e.actor,'assignee',e.assignee,
        'occurred_at',e.occurred_at,'created_at',e.created_at,'disposition',e.disposition,'outcome',e.outcome,'notes',e.notes,
        'next_due_at',e.next_due_at,'duration_seconds',e.duration_seconds,'corrects_id',e.corrects_id,
        'superseded',exists(select 1 from bolna_manual_attempts correction where correction.corrects_id=e.id)) payload
    from bolna_manual_attempts e join bolna_assignments a on a.id=e.assignment_id
    where a.entity_type=$1 and a.entity_id=$2 and ($3::boolean or a.assignee=$4 and a.state<>'dropped')
    union all
    select 'callyzer',c.source_id,c.occurred_at,c.occurred_at,
      jsonb_build_object('source','callyzer','id',c.source_id,'occurred_at',c.occurred_at,'assignee',c.caller_email,
        'caller_name',u.name,'employee_number',c.employee_number,'client_number',c.client_number,
        'duration_seconds',c.duration_seconds,'call_type',c.call_type,'call_method',c.call_method,'call_mode',c.call_mode,
        'provider_synced_at',c.provider_synced_at,'superseded',false,'corrects_id',null)
    from callyzer_calls c left join bolna_app_users u on u.email=c.caller_email
    where c.account_key=$5 and ($3::boolean or c.caller_email=$4)
      and c.client_number ~ '^\\+?[0-9 ()-]+$'
      and (case when c.client_number ~ '^[0-9]{10}$' then '91'||c.client_number
        else regexp_replace(c.client_number,'[^0-9]','','g') end)=any($6::text[])
  )`;
  const counts=(await query<{total:number;logged:number;imported:number}>(`${events}
    select count(*)::int total,count(*) filter(where source='manual')::int logged,
      count(*) filter(where source='callyzer')::int imported from events`,values)).rows[0];
  const pages=Math.max(1,Math.ceil(counts.total/50));
  const current=Math.min(Math.max(1,Number.isFinite(page)?Math.floor(page):1),pages);
  const rows=(await query<{payload:ManualHistoryEvent}>(`${events} select payload from events
    order by occurred_at desc,created_at desc,source,id desc limit 50 offset $7`,[...values,(current-1)*50])).rows.map(row=>row.payload);
  return {rows,...counts,page:current,pages};
}

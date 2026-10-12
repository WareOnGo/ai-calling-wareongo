import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { ApiError } from "./api";
import { query, transaction } from "./db";
import type { EntityType } from "./scope";

export const ASSIGN_CAP = 20000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>[key,stable(v)]));
  return value;
}
export const allocationHash = (value: unknown) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
type Owner = { id: string; entity_type: string; entity_id: string; assignee: string; revision: number; phones: string[];
  state: 'open'; outcome: string | null; disposition: string | null; next_due_at: string | null };
type CompletedOwner = { assignee: string; state: 'done'; outcome: string | null; disposition: string | null; count: number };
type PreviewAi = { execution_id: string; status: string | null; result: string | null; known_attempts: number; recorded_at: string | null; scope: 'execution' | 'contact' };
export type AllocationItem = {
  id: string; name: string | null; phones: string[]; disposition: "assign" | "reassign" | "owned" | "duplicate" | "missing_phone";
  assignee: string | null; owners: Owner[]; completed: number; completed_by: CompletedOwner[]; ai_result: string | null; ai: PreviewAi | null;
};
export type AssignSummary = {
  requested: number; assigned: number; reassigned: number; skipped: number; capped: boolean;
  duplicateContacts: number; skippedOwned: number; skippedNoPhone: number; retained: number;
  batchId: string; perCaller: Record<string, number>;
};
export type AllocationOptions = {
  entity: EntityType; ids: string[]; assignee?: string; assignees?: string[]; assignedBy: string;
  note?: string | null; reassign?: boolean; intentKey?: string; requestHash?: string;
  selection?: unknown; expectedPreview?: string; capped?: boolean;
};
export type AllocationPreview = {
  previewHash: string; requested: number; validPhones: number; uniquePhones: number;
  eligible: number; owned: number; duplicateContacts: number; missingPhone: number; completedHistory: number;
  ownerCounts: Record<string, number>; completedOwners: Record<string, number>; aiResults: Record<string, number>; aiStatuses: Record<string, number>; perCaller: Record<string, number>;
  capped: boolean; items: AllocationItem[];
};
function normalize(opts: AllocationOptions) {
  if (opts.ids.some(id => !uuid.test(id))) throw new ApiError(400, "Invalid assignment target");
  const unique = [...new Set(opts.ids.map(id=>id.toLowerCase()))].sort();
  const callers = [...new Set((opts.assignees ?? (opts.assignee ? [opts.assignee] : [])).map(email=>email.trim().toLowerCase()))].sort();
  if (!callers.length || callers.length > 100) throw new ApiError(400,"Choose between 1 and 100 active callers");
  return { ids: unique.slice(0,ASSIGN_CAP), callers, capped: unique.length > ASSIGN_CAP };
}
async function plan(client: PoolClient, opts: AllocationOptions): Promise<AllocationPreview> {
  const { ids, callers, capped } = normalize(opts);
  const active = await client.query("select email from bolna_app_users where email=any($1::text[]) and active order by email",[callers]);
  if (active.rowCount !== callers.length) throw new ApiError(400,"Every assignee must be an active user");
  const table = opts.entity === "record" ? "raw_records" : "bolna_call_logs";
  const found = await client.query<{id:string;name:string|null}>(`select id, ${opts.entity === "record" ? "owner_name" : "context_details->'recipient_data'->>'name'"} as name from ${table} where id=any($1::uuid[]) order by id`,[ids]);
  if (found.rowCount !== ids.length) throw new ApiError(409,"Some selected rows no longer exist. Refresh the selection.");
  const names = new Map(found.rows.map(row => [row.id, row.name]));
  const contacts = (await client.query<{entity_id:string;phone_last10:string}>("select entity_id,phone_last10 from bolna_assignment_contacts where entity_type=$1 and entity_id=any($2::uuid[]) order by entity_id,phone_last10",[opts.entity,ids])).rows;
  const byId = new Map<string,string[]>();
  for (const row of contacts) byId.set(row.entity_id,[...(byId.get(row.entity_id)||[]),row.phone_last10]);
  const phones=[...new Set(contacts.map(row=>row.phone_last10))];
  const owners=(await client.query<Owner>(`select a.id::text,a.entity_type,a.entity_id,a.assignee,a.revision,a.state,a.outcome,a.disposition,a.next_due_at::text,
      coalesce(array_agg(v.phone_last10 order by v.phone_last10) filter(where v.phone_last10 is not null),'{}') as phones
      from bolna_assignments a left join bolna_assignment_contacts v using(entity_type,entity_id)
      where a.state='open' and ((a.entity_type=$1 and a.entity_id=any($2::uuid[])) or exists
      (select 1 from bolna_assignment_contacts c where c.entity_type=a.entity_type and c.entity_id=a.entity_id and c.phone_last10=any($3::text[])))
      group by a.id order by a.id`,[opts.entity,ids,phones])).rows;
  const history=(await client.query<CompletedOwner & {entity_id:string}>(`with targets as (
    select id entity_id from unnest($2::uuid[]) id
   ), matches as (
    select t.entity_id,a.id,a.assignee,a.state,a.outcome,a.disposition from targets t join bolna_assignments a
     on a.entity_type=$1 and a.entity_id=t.entity_id and a.state='done'
    union
    select t.entity_id,a.id,a.assignee,a.state,a.outcome,a.disposition from targets t
     join bolna_assignment_contacts tc on tc.entity_type=$1 and tc.entity_id=t.entity_id
     join bolna_assignment_contacts hc using(phone_last10)
     join bolna_assignments a on a.entity_type=hc.entity_type and a.entity_id=hc.entity_id and a.state='done'
   ) select entity_id,assignee,state,outcome,disposition,count(*)::int count from matches
    group by entity_id,assignee,state,outcome,disposition order by entity_id,assignee,outcome nulls last,disposition nulls last`,[opts.entity,ids])).rows;
  const completed=new Map<string,number>(), completedById=new Map<string,CompletedOwner[]>(), completedOwners:Record<string,number>={};
  for (const {entity_id,...row} of history) {
    completed.set(entity_id,(completed.get(entity_id)||0)+row.count); completedOwners[row.assignee]=(completedOwners[row.assignee]||0)+row.count;
    completedById.set(entity_id,[...(completedById.get(entity_id)||[]),row]);
  }
  // Call selections describe that exact execution. Raw selections have only
  // contact-level AI context, which is labeled explicitly in the preview.
  const aiSource=opts.entity==='call'
    ? `select c.id entity_id,c.* from bolna_call_logs c where c.id=any($1::uuid[])`
    : `select distinct on(v.entity_id) v.entity_id,c.* from bolna_assignment_contacts v
       join bolna_call_logs c on c.phone_last10=v.phone_last10 and c.status is distinct from 'balance-low'
       where v.entity_type='record' and v.entity_id=any($1::uuid[])
       order by v.entity_id,c.call_created_at desc nulls last,c.id`;
  const ai=(await client.query<PreviewAi & {entity_id:string}>(`select c.entity_id,c.id execution_id,c.status,
    case when c.status in ('completed','call-disconnected') then bolna_availability(c.status,c.llm_availability) end result,
    c.call_created_at::text recorded_at,(select count(*)::int from bolna_ai_attempts a where a.execution_id=c.id) known_attempts,
    '${opts.entity==='call'?'execution':'contact'}'::text scope from (${aiSource}) c`,[ids])).rows;
  const aiById=new Map(ai.map(({entity_id,...row})=>[entity_id,row]));
  const ownerByPhone=new Map<string,Owner[]>(), ownerByEntity=new Map<string,Owner>();
  for(const owner of owners) {
    ownerByEntity.set(`${owner.entity_type}:${owner.entity_id}`,owner);
    for(const phone of owner.phones) ownerByPhone.set(phone,[...(ownerByPhone.get(phone)||[]),owner]);
  }
  const seen=new Set<string>(), perCaller: Record<string,number>={}, ownerCounts: Record<string,number>={}, aiResults: Record<string,number>={}, aiStatuses: Record<string,number>={};
  // Continue the rotation across batches for this exact caller set.
  const prior=(await client.query("select coalesce(sum((summary->>'assigned')::integer),0)::integer n from bolna_assignment_batches where assignees=$1::text[]",[callers])).rows[0].n;
  let cursor=0;
  const items: AllocationItem[]=ids.map(id=>{
    const rowPhones=byId.get(id)||[], same=ownerByEntity.get(`${opts.entity}:${id}`);
    const overlapping=[...new Map([...(same?[same]:[]),...rowPhones.flatMap(phone=>ownerByPhone.get(phone)||[])].map(owner=>[owner.id,owner])).values()];
    for(const email of new Set(overlapping.map(owner=>owner.assignee))) ownerCounts[email]=(ownerCounts[email]||0)+1;
    const ai=aiById.get(id)??null,ai_result=ai?.result??null;
    if(ai) {
      aiResults[ai_result||"No result"]=(aiResults[ai_result||"No result"]||0)+1;
      aiStatuses[ai.status||"Unknown status"]=(aiStatuses[ai.status||"Unknown status"]||0)+1;
    }
    const assignee=callers[(Number(prior)+cursor)%callers.length];
    const disposition=!rowPhones.length?"missing_phone":rowPhones.some(phone=>seen.has(phone))?"duplicate":
      overlapping.length && (!opts.reassign || overlapping.some(owner=>callers.includes(owner.assignee)))?"owned":overlapping.length?"reassign":"assign";
    if(disposition==="assign" || disposition==="reassign") {
      cursor++; perCaller[assignee]=(perCaller[assignee]||0)+1; rowPhones.forEach(phone=>seen.add(phone));
    }
    return {id,name:names.get(id) || null,phones:rowPhones,disposition,assignee:disposition==="assign"||disposition==="reassign"?assignee:null,owners:overlapping,completed:completed.get(id)||0,completed_by:completedById.get(id)||[],ai_result,ai};
  });
  const count=(disposition:string)=>items.filter(item=>item.disposition===disposition).length;
  return { previewHash:allocationHash({entity:opts.entity,callers,reassign:!!opts.reassign,items:items.map(({id,phones,disposition,assignee,owners})=>({id,phones,disposition,assignee,owners:owners.map(({id,assignee,phones})=>({id,assignee,phones}))}))}),
    requested:ids.length,validPhones:byId.size,uniquePhones:phones.length,eligible:cursor,owned:count("owned"),duplicateContacts:count("duplicate"),missingPhone:count("missing_phone"),
    completedHistory:completed.size,ownerCounts,completedOwners,aiResults,aiStatuses,perCaller,capped:capped||!!opts.capped,items };
}
export async function previewAssignment(opts: AllocationOptions) {
  return transaction(async client=>{await client.query("set transaction isolation level repeatable read read only");return plan(client,opts);});
}
export async function assignmentReplay(actor:string,key:string,hash:string): Promise<AssignSummary|null> {
  const row=(await query("select request_hash,summary from bolna_assignment_batches where created_by=$1 and intent_key=$2",[actor.toLowerCase(),key])).rows[0];
  if(row && row.request_hash!==hash) throw new ApiError(409,"This assignment key was already used for a different request");
  return row?.summary??null;
}
export async function assignEntities(opts: AllocationOptions): Promise<AssignSummary> {
  const {callers}=normalize(opts), actor=opts.assignedBy.toLowerCase(), key=opts.intentKey??randomUUID();
  const hash=opts.requestHash??allocationHash({...opts,ids:[...new Set(opts.ids)].sort(),assignees:callers,expectedPreview:undefined});
  return transaction(async client=>{
    await client.query("select pg_advisory_xact_lock(81620404)");
    await client.query("select set_config('bolna.actor',$1,true)",[actor]);
    const existing=(await client.query("select request_hash,summary from bolna_assignment_batches where created_by=$1 and intent_key=$2",[actor,key])).rows[0];
    if(existing){if(existing.request_hash!==hash)throw new ApiError(409,"This assignment key was already used for a different request");return existing.summary;}
    const preview=await plan(client,opts);
    if(opts.expectedPreview && opts.expectedPreview!==preview.previewHash) throw new ApiError(409,"Selection or ownership changed. Review the refreshed preview before assigning.");
    const batchId=(await client.query<{id:string}>(`insert into bolna_assignment_batches(intent_key,created_by,entity_type,distribution,assignees,selection,request_hash)
      values($1,$2,$3,$4,$5,$6::jsonb,$7) returning id`,[key,actor,opts.entity,callers.length>1?"round_robin":"single",callers,JSON.stringify(opts.selection??{ids:opts.ids}),hash])).rows[0].id;
    const eligible=preview.items.filter(item=>item.disposition==="assign"||item.disposition==="reassign");
    const dropped=[...new Set(eligible.flatMap(item=>item.owners.map(owner=>owner.id)))];
    if(dropped.length) await client.query("update bolna_assignments set state='dropped',completed_at=now(),revision=revision+1 where id=any($1::bigint[]) and state='open'",[dropped]);
    const inserted=(await client.query<{id:string;entity_id:string}>(`insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,note,batch_id)
      select $1,x.id,x.assignee,$2,$3,$4 from jsonb_to_recordset($5::jsonb) as x(id uuid,assignee text) returning id::text,entity_id`,[opts.entity,actor,opts.note||null,batchId,JSON.stringify(eligible)])).rows;
    const insertedById=new Map(inserted.map(row=>[row.entity_id,row.id]));
    await client.query(`insert into bolna_assignment_batch_items(batch_id,entity_id,assignment_id,disposition,assignee,phones,previous_owners)
      select $1,x.id,x.assignment_id,x.disposition,x.assignee,x.phones,x.owners from jsonb_to_recordset($2::jsonb)
      as x(id uuid,assignment_id bigint,disposition text,assignee text,phones text[],owners jsonb)`,[batchId,JSON.stringify(preview.items.map(item=>({...item,assignment_id:insertedById.get(item.id)??null})))]);
    const result: AssignSummary={requested:preview.requested,assigned:inserted.length,reassigned:dropped.length,skipped:preview.requested-inserted.length,
      capped:preview.capped,duplicateContacts:preview.duplicateContacts,skippedOwned:preview.owned,skippedNoPhone:preview.missingPhone,
      retained:preview.items.filter(item=>item.disposition==="owned"&&item.owners.some(owner=>callers.includes(owner.assignee))).length,batchId,perCaller:preview.perCaller};
    await client.query("update bolna_assignment_batches set summary=$2::jsonb where id=$1",[batchId,JSON.stringify(result)]);
    return result;
  });
}

import {z} from 'zod';
import type {PoolClient} from 'pg';
import {ApiError,bigintId} from './api';
import {transaction} from './db';
import {allocationHash} from './assignment-allocation';
import { CONTACT_PHONES_SQL } from "./assignment-contacts";
import {assignmentFiltersSchema} from './filters';
import {assignmentSelectionQuery} from './assignments';
import type {Viewer} from './scope';
import { warehousesByPhone } from './warehouse-contacts';

export const BULK_ASSIGNMENT_LIMIT=20000;
export const bulkAssignmentSchema=z.object({
  action:z.enum(['unassign','reopen']),
  ids:z.array(bigintId).min(1).max(BULK_ASSIGNMENT_LIMIT).transform(ids=>[...new Set(ids)]).optional(),
  filters:assignmentFiltersSchema.optional(),
  previewHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict().refine(body=>!!body.ids!==!!body.filters,'Provide selected IDs or all-matching filters');
export type BulkAssignmentRequest=z.infer<typeof bulkAssignmentSchema>;
export type BulkAssignmentPreview={action:'unassign'|'reopen';selected:number;eligible:number;skippedState:number;skippedOwner:number;skippedInactive:number;skippedWarehouse:number;previewHash:string};
type Selected={id:string;entity_type:string;entity_id:string;assignee:string;state:string;revision:number};

async function plan(client:PoolClient,viewer:Viewer,body:BulkAssignmentRequest,lock=false) {
  const {type,...filters}=body.filters||{};
  const selection=assignmentSelectionQuery(viewer,{...filters,entity_type:type},body.ids);
  const rows=(await client.query<Selected>(`${selection.sql} order by a.id desc limit ${BULK_ASSIGNMENT_LIMIT+1}${lock?' for update of a':''}`,selection.params)).rows;
  if(rows.length>BULK_ASSIGNMENT_LIMIT)throw new ApiError(400,`Select at most ${BULK_ASSIGNMENT_LIMIT.toLocaleString()} assignments. Narrow the filters first.`);
  if(body.ids&&rows.length!==body.ids.length)throw new ApiError(409,'Some assignments no longer exist. Refresh the selection.');
  const eligible:string[]=[],selectedState=body.action==='unassign'?'open':'done';
  let skippedState=0,skippedOwner=0,skippedInactive=0,skippedWarehouse=0;
  const registered=new Set<string>();
  const candidates=rows.filter(row=>row.state===selectedState);
  const keys=new Map<string,string[]>();
  const occupied=new Set<string>();
  let active=new Set<string>();
  if(body.action==='reopen'&&candidates.length) {
    active=new Set((await client.query<{email:string}>('select email from bolna_app_users where active and email=any($1::text[])',[candidates.map(row=>row.assignee)])).rows.map(row=>row.email));
    const contacts=(await client.query<{id:string;phone_last10:string}>(`select a.id::text,c.phone_last10 from bolna_assignments a
      join (${CONTACT_PHONES_SQL}) c using(entity_type,entity_id) where a.id=any($1::bigint[])`,[candidates.map(row=>row.id)])).rows;
    for(const row of candidates)keys.set(row.id,[`entity:${row.entity_type}:${row.entity_id}`]);
    for(const contact of contacts)keys.get(contact.id)!.push(`phone:${contact.phone_last10}`);
    const warehouses=await warehousesByPhone(client,contacts.map(c=>c.phone_last10));
    for(const contact of contacts)if(warehouses.has(contact.phone_last10))registered.add(contact.id);
    const owners=(await client.query<{entity_type:string;entity_id:string;phone_last10:string|null}>(`select a.entity_type,a.entity_id,c.phone_last10
      from bolna_assignments a left join (${CONTACT_PHONES_SQL}) c using(entity_type,entity_id)
      where a.state='open' and (a.entity_id=any($1::uuid[]) or c.phone_last10=any($2::text[]))`,
      [candidates.map(row=>row.entity_id),contacts.map(row=>row.phone_last10)])).rows;
    for(const owner of owners){occupied.add(`entity:${owner.entity_type}:${owner.entity_id}`);if(owner.phone_last10)occupied.add(`phone:${owner.phone_last10}`);}
  }
  for(const row of rows) {
    if(row.state!==selectedState){skippedState++;continue;}
    if(body.action==='reopen') {
      if(registered.has(row.id)){skippedWarehouse++;continue;}
      if(!active.has(row.assignee)){skippedInactive++;continue;}
      const contactKeys=keys.get(row.id)!;
      if(contactKeys.some(key=>occupied.has(key))){skippedOwner++;continue;}
      contactKeys.forEach(key=>occupied.add(key));
    }
    eligible.push(row.id);
  }
  const preview:BulkAssignmentPreview={action:body.action,selected:rows.length,eligible:eligible.length,skippedState,skippedOwner,skippedInactive,skippedWarehouse,
    previewHash:allocationHash({action:body.action,rows,eligible})};
  return {preview,eligible};
}

export async function bulkAssignments(viewer:Viewer,input:unknown,apply=false) {
  if(!viewer.isAdmin)throw new ApiError(403,'Only admins can change assignments in bulk');
  const body=bulkAssignmentSchema.parse(input);
  if(apply&&!body.previewHash)throw new ApiError(400,'Review the selection before applying');
  return transaction(async client=>{
    if(apply) {
      await client.query('select pg_advisory_xact_lock(81620404)');
      await client.query("select set_config('bolna.actor',$1,true)",[viewer.email.toLowerCase()]);
    } else await client.query('set transaction isolation level repeatable read read only');
    const {preview,eligible}=await plan(client,viewer,body,apply);
    if(!apply)return {...preview,changed:0};
    if(body.previewHash!==preview.previewHash)throw new ApiError(409,'Assignments or ownership changed. Review a fresh preview before applying.');
    if(!eligible.length)return {...preview,changed:0};
    const updated=await client.query(`update bolna_assignments set state=$2,
      completed_at=case when $2='open' then null else now() end,revision=revision+1
      where id=any($1::bigint[])`,[eligible,body.action==='unassign'?'dropped':'open']);
    return {...preview,changed:updated.rowCount||0};
  });
}

import {afterAll,beforeAll,beforeEach,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {getPool,query,transaction} from '@/lib/db';
import {listAssignments,matchingAssignmentTotals,updateAssignment} from '@/lib/assignments';
import {personalWork,personalTotals} from '@/lib/personal-work';
import {bulkAssignments,bulkAssignmentSchema} from '@/lib/bulk-assignments';
import {recordManualAttempt} from '@/lib/manual-attempts';
import {parseTeamFilters,teamSummary,teamDetails,teamDetailExport} from '@/lib/team-report';
import {RETRY_DISPOSITIONS} from '@/lib/manual-dispositions';
import {batchMembers,batchMembersExport,getBatch} from '@/lib/batch-browser';
import {seedLegacyAssignments} from './fixtures';

const admin={email:'admin@v2.test',name:null,isAdmin:true};
const employee={email:'caller@v2.test',name:null,isAdmin:false};
const other={email:'other@v2.test',name:null,isAdmin:false};
beforeAll(()=>{if(!process.env.TEST_DATABASE_URL||!['127.0.0.1','localhost','[::1]'].includes(new URL(process.env.TEST_DATABASE_URL).hostname))throw Error('Disposable local DB required');});
beforeEach(async()=>{
  await query('truncate bolna_assignments,bolna_app_users,bolna_call_logs,raw_records,raw_phones,raw_phone_numbers restart identity cascade');
  await query("insert into bolna_app_users(email,role) values($1,'admin'),($2,'employee'),($3,'employee')",[admin.email,employee.email,other.email]);
});
afterAll(async()=>{await getPool().end();});

async function target(city='Bengaluru',state='Karnataka') {
  const id=randomUUID();
  await query("insert into raw_records(id,source,source_record_id,owner_name,city,state) values($1::uuid,'v2',$1::text,'Test contact',$2,$3)",[id,city,state]);
  const phone=(await query("insert into raw_phone_numbers(phone,phone_last10) values($1,$1) returning phone_id",[String(Math.floor(9000000000+Math.random()*999999999))])).rows[0].phone_id;
  await query('insert into raw_phones(master_id,phone_id,is_primary) values($1,$2,true)',[id,phone]);
  const call=randomUUID();
  await query("insert into bolna_call_logs(id,phone_id,call_type,to_number,status,llm_availability,context_details) select $1,phone_id,'outbound',phone,'completed','Available','{}'::jsonb from raw_phone_numbers where phone_id=$2",[call,phone]);
  return {id,call,phone};
}
async function assign(entity:string,kind='record',state='open',outcome:string|null=null,owner=employee.email) {
  return (await seedLegacyAssignments(`insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state,outcome,assigned_at,remarks)
    values($1,$2,$3,$4,$5,$6,'2025-01-01T00:00:00Z','Retained notes') returning id::text,revision`,[kind,entity,owner,admin.email,state,outcome])).rows[0] as {id:string;revision:number};
}

it('My Work, assignment rows and totals filter on the displayed source city and state',async()=>{
  const t=await target();await assign(t.call,'call');
  await query("update bolna_call_logs set context_details='{\"recipient_data\":{\"area\":\"  \"}}' where id=$1",[t.call]);
  const f={city:'bengaluru',region:'karnataka'};
  expect((await personalWork(employee,'call',f,1)).rows[0].context.city).toBe('Bengaluru');
  expect((await listAssignments(admin,f)).total).toBe(1);
  expect((await listAssignments(admin,f)).rows[0].city).toBe('Bengaluru');
  expect((await listAssignments(admin,f)).rows[0].subject).toBe('Test contact');
  expect((await listAssignments(admin,{q:'Test contact'})).total).toBe(1);
  expect((await personalWork(employee,'call',{q:'Bengaluru'},1)).total).toBe(1);
  expect((await personalTotals(employee.email,f)).call.open).toBe(1);
  expect((await matchingAssignmentTotals(admin,f))[0].n).toBe('1');
  expect((await personalWork(other,'call',f,1)).total).toBe(0);
  expect((await listAssignments(admin,{region:'Maharashtra'})).total).toBe(0);
  expect((await listAssignments(admin,{city:'%'})).total).toBe(0);
});

it('mismatch review compares exact AI-call results and excludes shared-phone listing context and absent results',async()=>{
  const mismatch=await target(),match=await target(),listing=await target(),absent=await target(),unenriched=await target();
  const a=await assign(mismatch.call,'call','open','Unavailable');
  await assign(match.call,'call','open','Available');await assign(listing.id,'record','open','Unavailable');
  await assign(absent.call,'call','open','Unavailable');
  await assign(unenriched.call,'call','open','Unavailable');
  await query("update bolna_call_logs set status='balance-low',llm_availability=null where id=$1",[absent.call]);
  await query('update bolna_call_logs set llm_availability=null where id=$1',[unenriched.call]);
  const f={comparison:'mismatch' as const};
  expect((await listAssignments(admin,f)).rows.map(row=>row.id)).toEqual([a.id]);
  expect((await matchingAssignmentTotals(admin,f))[0].n).toBe('1');
  const preview=await bulkAssignments(admin,{action:'unassign',filters:f});
  expect(preview.eligible).toBe(1);
});

it('source fallback names sort and search consistently across tables and bulk selection',async()=>{
  const first=await target('Pune','Maharashtra'),last=await target('Pune','Maharashtra');
  await query("update raw_records set owner_name='Asha' where id=$1",[first.id]);
  await query("update raw_records set owner_name='Zoya' where id=$1",[last.id]);
  const a=await assign(first.call,'call'),b=await assign(last.call,'call');
  const f={sort:'name' as const};
  expect((await listAssignments(admin,f)).rows.map(row=>row.id)).toEqual([a.id,b.id]);
  expect((await personalWork(employee,'call',f,1)).rows.map(row=>row.who)).toEqual(['Asha','Zoya']);
  const preview=await bulkAssignments(admin,{action:'unassign',filters:{q:'Asha',type:['call'],region:'Maharashtra',ai_result:'Available'}});
  expect(preview).toMatchObject({selected:1,eligible:1});
  const batch=await getBatch(admin,'manual','legacy');
  const members=await batchMembers(admin,batch,'all',1,{q:'Asha',city:'Pune'});
  expect(members.rows.map(row=>row.name)).toEqual(['Asha']);
  const csv=batchMembersExport(admin,batch,'all',{q:'Asha',city:'Pune'});
  expect((await query(csv.sql,csv.params)).rowCount).toBe(1);
});

it('all-matching selection includes every filtered page and becomes stale when a new matching assignment arrives',async()=>{
  for(let i=0;i<53;i++)await assign((await target()).id);
  const body={action:'unassign' as const,filters:{region:'Karnataka'}},preview=await bulkAssignments(admin,body);
  expect((await listAssignments(admin,body.filters)).rows).toHaveLength(50);
  expect(preview).toMatchObject({selected:53,eligible:53});
  await assign((await target()).id);
  await expect(bulkAssignments(admin,{...body,previewHash:preview.previewHash},true)).rejects.toMatchObject({status:409});
  expect((await listAssignments(admin,{state:'open'})).total).toBe(54);
});

it('bulk unassign applies only to the selected open assignments and records the admin without losing notes',async()=>{
  const a=await assign((await target()).id),b=await assign((await target()).id),done=await assign((await target()).id,'record','done','Unavailable');
  const body={action:'unassign' as const,ids:[a.id,done.id]};
  const preview=await bulkAssignments(admin,body);
  expect(preview).toMatchObject({selected:2,eligible:1,skippedState:1,changed:0});
  expect((await query('select state from bolna_assignments where id=$1',[a.id])).rows[0].state).toBe('open');
  expect((await bulkAssignments(admin,{...body,previewHash:preview.previewHash},true)).changed).toBe(1);
  expect((await query('select state,remarks from bolna_assignments where id=$1',[a.id])).rows[0]).toEqual({state:'dropped',remarks:'Retained notes'});
  expect((await query('select state from bolna_assignments where id=$1',[b.id])).rows[0].state).toBe('open');
  expect((await query('select actor from bolna_assignment_changes where assignment_id=$1 order by id desc limit 1',[a.id])).rows[0].actor).toBe(admin.email);
});

it('all-matching bulk actions retain caller and location filters',async()=>{
  const a=await assign((await target()).id);await assign((await target('Mumbai','Maharashtra')).id);await assign((await target()).id,'record','open',null,other.email);
  const body={action:'unassign' as const,filters:{assignee:employee.email,region:'Karnataka'}};
  const preview=await bulkAssignments(admin,body);expect(preview.eligible).toBe(1);
  await bulkAssignments(admin,{...body,previewHash:preview.previewHash},true);
  expect((await query("select id::text from bolna_assignments where state='dropped'")).rows.map(row=>row.id)).toEqual([a.id]);
});

it('a stale preview rejects the entire bulk action',async()=>{
  const a=await assign((await target()).id),b=await assign((await target()).id);
  const body={action:'unassign' as const,ids:[a.id,b.id]},preview=await bulkAssignments(admin,body);
  await updateAssignment(a.id,admin,{revision:a.revision,remarks:'Changed after preview'});
  await expect(bulkAssignments(admin,{...body,previewHash:preview.previewHash},true)).rejects.toMatchObject({status:409});
  expect((await query("select count(*)::int n from bolna_assignments where state='open'")).rows[0].n).toBe(2);
});

it('bulk reopening skips occupied contacts, duplicate targets and inactive callers',async()=>{
  const occupied=await target(),duplicate=await target(),inactive=await target();
  const blocked=await assign(occupied.id,'record','done','Unavailable');await assign(occupied.call,'call','open',null,other.email);
  const first=await assign(duplicate.id,'record','done','Unavailable'),second=await assign(duplicate.call,'call','done','Unavailable');
  const off=await assign(inactive.id,'record','done','Unavailable',other.email);
  await query('update bolna_app_users set active=false where email=$1',[other.email]);
  const body={action:'reopen' as const,ids:[blocked.id,first.id,second.id,off.id]},preview=await bulkAssignments(admin,body);
  expect(preview).toMatchObject({selected:4,eligible:1,skippedOwner:2,skippedInactive:1});
  expect((await bulkAssignments(admin,{...body,previewHash:preview.previewHash},true)).changed).toBe(1);
  expect((await query('select state,completed_at from bolna_assignments where id=$1',[second.id])).rows[0]).toEqual({state:'open',completed_at:null});
});

it('new contact ownership invalidates a reopen preview',async()=>{
  const t=await target(),a=await assign(t.id,'record','done','Unavailable');
  const body={action:'reopen' as const,ids:[a.id]},preview=await bulkAssignments(admin,body);
  await assign(t.call,'call','open',null,other.email);
  await expect(bulkAssignments(admin,{...body,previewHash:preview.previewHash},true)).rejects.toMatchObject({status:409});
});

it.each(['record','call'] as const)('single %s reopening respects shared-phone owners with production guards disabled',async kind=>{
  const t=await target();
  const closed=await assign(kind==='record'?t.id:t.call,kind,'done','Unavailable');
  const owner=await assign(kind==='record'?t.call:t.id,kind==='record'?'call':'record','open',null,other.email);
  await query('alter table bolna_assignments disable trigger bolna_assignment_contacts_sync; alter table bolna_assignments disable trigger bolna_assignment_quality_guard');
  try {
    const preview=await bulkAssignments(admin,{action:'reopen',ids:[closed.id]});
    expect(preview).toMatchObject({eligible:0,skippedOwner:1});
    await expect(updateAssignment(closed.id,admin,{revision:closed.revision,state:'open'})).rejects.toMatchObject({status:409});
    expect((await query('select state,revision,remarks from bolna_assignments where id=$1',[closed.id])).rows[0])
      .toEqual({state:'done',revision:closed.revision,remarks:'Retained notes'});
    await updateAssignment(owner.id,admin,{revision:owner.revision,state:'dropped'});
    expect(await updateAssignment(closed.id,admin,{revision:closed.revision,state:'open'}))
      .toMatchObject({state:'open',revision:closed.revision+1,remarks:'Retained notes'});
  } finally {
    await query('alter table bolna_assignments enable trigger bolna_assignment_contacts_sync; alter table bolna_assignments enable trigger bolna_assignment_quality_guard');
  }
});

it('bulk writes require an admin, an explicit selection and a reviewed preview',async()=>{
  const a=await assign((await target()).id),body={action:'unassign' as const,ids:[a.id]};
  await expect(bulkAssignments(employee,body)).rejects.toMatchObject({status:403});
  await expect(bulkAssignments(admin,body,true)).rejects.toMatchObject({status:400});
  expect(bulkAssignmentSchema.safeParse({action:'unassign'}).success).toBe(false);
  expect(bulkAssignmentSchema.safeParse({...body,filters:{}}).success).toBe(false);
  await expect(bulkAssignments(admin,{action:'unassign'})).rejects.toThrow();
  await expect(bulkAssignments(admin,{...body,filters:{}})).rejects.toThrow();
  const repeated=await bulkAssignments(admin,{...body,ids:[...body.ids,...body.ids]});
  expect(repeated.selected).toBe(1);
});

it.each(['owner_unresponsive','leased_out','no_property_for_rent'] as const)('logs and filters the new manual tag %s',async disposition=>{
  const a=await assign((await target()).id);
  await recordManualAttempt(a.id,employee,{id:randomUUID(),revision:a.revision,occurred_at:'2026-01-01T10:00:00Z',disposition,outcome:'Unavailable',duration_seconds:20});
  expect((await listAssignments(admin,{manual_disposition:disposition})).total).toBe(1);
  const report=(await teamSummary(admin,parseTeamFilters({range:'all'}))).find(row=>row.email===employee.email)!;
  expect(report.counts.attempts).toBe(1);
  expect(report.counts.connected||0).toBe(disposition==='owner_unresponsive'?0:1);
  const batch=await getBatch(admin,'manual','legacy');
  const members=await batchMembers(admin,batch,'connected');
  expect(members.total).toBe(disposition==='owner_unresponsive'?0:1);
  const csv=batchMembersExport(admin,batch,'connected');
  expect((await query(csv.sql,csv.params)).rowCount).toBe(members.total);
  if(disposition==='owner_unresponsive')await expect(updateAssignment(a.id,employee,{revision:1,state:'done'})).rejects.toMatchObject({code:'FOLLOW_UP_REQUIRED'});
  else expect((await updateAssignment(a.id,employee,{revision:1,state:'done'}))?.state).toBe('done');
  expect((await query('select bolna_retry_dispositions() values')).rows[0].values).toEqual(RETRY_DISPOSITIONS);
});

it('migration 012 extends tags while retaining live-style trigger settings, rows and history',async()=>{
  const a=await assign((await target()).id);
  await recordManualAttempt(a.id,employee,{id:randomUUID(),revision:0,occurred_at:'2026-10-15T10:00:00Z',disposition:'connected',notes:'Retained call evidence'});
  const client=await getPool().connect();
  try {
    await client.query('begin');
    const oldTags=['connected','no_answer','busy','switched_off','callback','awaiting_confirmation','invalid_number'];
    for(const table of ['bolna_assignments','bolna_manual_attempts']) {
      await client.query(`alter table ${table} drop constraint ${table}_disposition_check;
        alter table ${table} add constraint ${table}_disposition_check check(disposition in (${oldTags.map(tag=>`'${tag}'`).join(',')}))`);
    }
    await client.query(`create or replace function bolna_retry_dispositions() returns text[] language sql immutable parallel safe as $$
      select array['no_answer','busy','switched_off','callback','awaiting_confirmation']::text[] $$;
      alter table bolna_assignments disable trigger bolna_assignment_contacts_sync;
      alter table bolna_assignments disable trigger bolna_assignment_quality_guard`);
    const snapshot=async()=> (await client.query(`select
      (select jsonb_agg(a order by id) from bolna_assignments a) assignments,
      (select jsonb_agg(e order by id) from bolna_manual_attempts e) attempts,
      (select jsonb_agg(c order by id) from bolna_assignment_changes c) changes,
      (select jsonb_agg(jsonb_build_array(tgname,tgenabled) order by tgname) from pg_trigger
       where tgrelid='bolna_assignments'::regclass and not tgisinternal) triggers`)).rows[0];
    const before=await snapshot();
    await client.query(await readFile(new URL('../../database/migrations/012_manual_call_tags.sql',import.meta.url),'utf8'));
    expect(await snapshot()).toEqual(before);
    expect((await client.query('select bolna_retry_dispositions() tags')).rows[0].tags).toEqual(RETRY_DISPOSITIONS);
    for(const tag of ['owner_unresponsive','leased_out','no_property_for_rent']) {
      await client.query('update bolna_assignments set disposition=$2 where id=$1',[a.id,tag]);
      await client.query(`insert into bolna_manual_attempts(id,assignment_id,actor,assignee,occurred_at,disposition,request_hash)
        values($1,$2,$3,$3,now(),$4,'migration rehearsal')`,[randomUUID(),a.id,employee.email,tag]);
    }
  } finally {await client.query('rollback');client.release();}
});

it('All time includes old attempts and undated legacy verification with matching evidence and CSV totals',async()=>{
  const t=await target();
  const a=await transaction(async client=>{
    await client.query('alter table bolna_assignments disable trigger bolna_assignment_initial_audit');
    const row=(await client.query("insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,outcome,added_to_db,wh_id,assigned_at) values('record',$1,$2,$3,'Available',true,'123','2025-01-01') returning id::text",[t.id,employee.email,admin.email])).rows[0];
    await client.query('alter table bolna_assignments enable trigger bolna_assignment_initial_audit');return row;
  });
  await query("insert into bolna_manual_attempts(id,assignment_id,actor,assignee,occurred_at,disposition,request_hash) values($1,$2,$3,$3,'2025-02-01','connected','fixture')",[randomUUID(),a.id,employee.email]);
  const f=parseTeamFilters({range:'all',date_from:'2026-10-01',date_to:'2026-10-02'});
  expect(f.date_from).toBeUndefined();expect(f.date_to).toBeUndefined();
  const row=(await teamSummary(admin,f)).find(row=>row.email===employee.email)!;
  expect(row.counts).toMatchObject({attempts:1,available:1,onboarded:1});
  const dated=(await teamSummary(admin,parseTeamFilters({date_from:'2026-10-01',date_to:'2026-10-02'}))).find(row=>row.email===employee.email)!;
  expect(dated.counts).toEqual({});
  const detail=await teamDetails(admin,{...f,metric:'available'});expect(detail.total).toBe(1);expect(detail.rows[0].occurred_at).toBeNull();
  const csv=teamDetailExport(admin,{...f,metric:'available'});expect((await query(csv.sql,csv.params)).rowCount).toBe(detail.total);
});

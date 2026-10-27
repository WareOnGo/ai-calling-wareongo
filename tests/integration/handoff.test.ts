import {seedLegacyAssignments,seedConnectedCalls} from './fixtures';
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { query, getPool } from "@/lib/db";
import { assignEntities, updateAssignment } from "@/lib/assignments";
import { getCalls, getCallIds, callsExportQuery } from "@/lib/calls";
import { getRawRecords, getRawRecordIds, rawExportQuery, getRelatedListings } from "@/lib/raw";
import { csvResponse } from "@/lib/export";
import { getAssigneeWorkloads } from "@/lib/users";
import { previewAssignment } from "@/lib/assignment-allocation";
const admin = { email: "admin@test.example", isAdmin: true, name: null };
const a = { email: "a@test.example", isAdmin: false, name: null };
const b = { email: "b@test.example", isAdmin: false, name: null };

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL || !["localhost", "127.0.0.1"].includes(new URL(process.env.TEST_DATABASE_URL).hostname)) throw new Error("Disposable local test DB required");
});
beforeEach(async () => {
  await query("truncate bolna_ai_attempts, bolna_assignments, bolna_app_users, bolna_webhook_events, bolna_call_logs, raw_phones, raw_records, raw_phone_numbers, call_batch_items, call_batches, bolna_dispatch_requests restart identity cascade");
  await query("insert into bolna_app_users(email, role) values ($1,'admin'),($2,'employee'),($3,'employee')", [admin.email, a.email, b.email]);
});
afterAll(async () => { await getPool().end(); });

async function listing(phone = "9876543210", name = "Example") {
  const id = randomUUID();
  await query("insert into raw_records(id,source,source_record_id,owner_name,city,state) values ($1::uuid,'fixture',$1::text,$2,'Delhi','Delhi')", [id, name]);
  const p = (await query("insert into raw_phone_numbers(phone_last10, phone) values ($1,$2) on conflict(phone_last10) do update set phone=excluded.phone returning phone_id", [phone, `+91${phone}`])).rows[0].phone_id;
  await query("insert into raw_phones(master_id,phone_id,is_primary) values ($1,$2,true)", [id, p]);
  return { id, phoneId: p };
}
async function call(phoneId: string, phone = "+919876543210") {
  const id = randomUUID();
  await query("insert into bolna_call_logs(id,status,call_type,to_number,phone_id,call_created_at) values ($1,'completed','outbound',$2,$3,now())", [id, phone, phoneId]);
  return id;
}
const assign = (entity: "record" | "call", ids: string[], owner = a.email, reassign = false) => assignEntities({ entity, ids, assignee: owner, assignedBy: admin.email, reassign });

 describe("handoff A: assignment ownership and contact deduplication", () => {
  it("Unassigned excludes completed history across grids, selection and export", async () => {
    const r = await listing(); const c = await call(r.phoneId);
    for (const [type,id] of [["record",r.id],["call",c]]) await seedLegacyAssignments("insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state,outcome,remarks) values ($1,$2,$3,$4,'done','Unavailable','old evidence')", [type,id,a.email,admin.email]);
    const raw = await getRawRecords(admin, { assignee: "none" });
    const calls = await getCalls(admin, { assignee: "none" });
    expect(raw.total).toBe(0); expect(calls.total).toBe(0);
    expect((await getRawRecords(admin,{})).rows[0].assignment_remarks).toBe("old evidence");
    expect((await getRawRecordIds(admin, { assignee: "none" }, 100)).ids).toEqual([]);
    expect((await getCallIds(admin, { assignee: "none" }, 100)).ids).toEqual([]);
    for (const spec of [rawExportQuery(admin, { assignee: "none" }), callsExportQuery(admin, { assignee: "none" })]) {
      const csv = await (await csvResponse(spec, [{ label: "Current owner", get: (row: { assigned_to: string | null }) => row.assigned_to }], "test.csv")).text();
      expect(csv).not.toContain(a.email);
    }
  });
  it("a named current-owner filter cannot match a previous assignee", async () => {
    const r = await listing();
    await seedLegacyAssignments("insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state,outcome) values ('record',$1,$2,$4,'done','Unavailable'),('record',$1,$3,$4,'open',null)", [r.id,a.email,b.email,admin.email]);
    expect((await getRawRecords(admin, { assignee: a.email })).total).toBe(0);
    expect((await getRawRecords(admin, { assignee: b.email })).rows[0].assigned_to).toBe(b.email);
    expect((await getRawRecords(a, {})).rows[0].assignment_state).toBe("done");
    expect((await getRawRecords(a, {})).rows[0].assignment_remarks).toBeNull();
  });
  it("deduplicates repeated entity IDs before validating selection", async () => {
    const r = await listing();
    expect((await assign("record", [r.id,r.id])).assigned).toBe(1);
  });
  it("assigns one calling task when several selected listings share a number", async () => {
    const r = await listing(); const duplicate = await listing();
    const result = await assign("record", [r.id,duplicate.id]);
    expect(result.assigned).toBe(1); expect(result.skipped).toBe(1);
    expect((await query("select count(*) n from raw_records")).rows[0].n).toBe("2");
  });
  it("refuses a second task for a contact already owned through the other channel", async () => {
    const r = await listing(); const c = await call(r.phoneId);
    await assign("record", [r.id]);
    expect((await assign("call", [c], b.email)).assigned).toBe(0);
    expect((await query("select assignee from bolna_assignments where state='open'")).rows).toEqual([{assignee:a.email}]);
  });
  it.each(['record','call'] as const)('preserves linked-phone ownership and reopening protection when the %s side is assigned',async entity=>{
    const r=await listing(),c=await call(r.phoneId);
    await query('update bolna_call_logs set to_number=null,from_number=null where id=$1',[c]);
    const target=entity==='record'?r.id:c,related=entity==='record'?c:r.id,other=entity==='record'?'call':'record';
    expect((await assign(entity,[target])).assigned).toBe(1);
    expect(await assign(other,[related],b.email)).toMatchObject({assigned:0,skippedOwned:1});
    expect((await getRawRecords(admin,{assignee:'none'})).total).toBe(0);
    expect((await getCalls(admin,{assignee:'none'})).total).toBe(0);
    expect((await getRawRecords(admin,{})).rows[0].assigned_to).toBe(a.email);
    expect((await getCalls(admin,{})).rows[0].assigned_to).toBe(a.email);
    await seedLegacyAssignments("insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state,outcome) values($1,$2,$3,$4,'done','Unavailable')",[other,related,b.email,admin.email]);
    const closed=(await query("select id::text from bolna_assignments where state='done'")).rows[0].id;
    await expect(updateAssignment(closed,admin,{state:'open',revision:0})).rejects.toThrow('already has open work');
  });
  it('uses an explicit execution number before its retained phone link',async()=>{
    const r=await listing(),c=await call(r.phoneId,'+919876543211');
    expect((await assign('record',[r.id])).assigned).toBe(1);
    expect((await assign('call',[c],b.email)).assigned).toBe(1);
  });
  it("serializes concurrent allocations of different entities with a shared phone", async () => {
    const r = await listing(); const duplicate = await listing(); const c = await call(r.phoneId);
    const results = await Promise.all([assign("record",[r.id],a.email),assign("record",[duplicate.id],b.email),assign("call",[c],b.email)]);
    expect(results.reduce((n,r)=>n+r.assigned,0)).toBe(1);
  });
  it("permits a new task after prior work is completed", async () => {
    const r = await listing(); const duplicate = await listing();
    await assign("record", [r.id]);
    await seedConnectedCalls();
    await query("update bolna_assignments set state='done',outcome='Unavailable' where entity_id=$1",[r.id]);
    expect((await assign("record", [duplicate.id],b.email)).assigned).toBe(1);
  });
  it("deduplicates shared secondary numbers too without deleting either listing", async () => {
    const r=await listing(); const second=await listing("9876543211");
    await query("insert into raw_phones(master_id,phone_id,is_primary) values ($1,$2,false)",[second.id,r.phoneId]);
    expect((await assign("record",[r.id,second.id])).assigned).toBe(1);
  });
  it("explicit reassignment transfers overlapping work and preserves the old episode", async () => {
    const r=await listing(); const duplicate=await listing();
    await assign("record",[r.id]);
    const res=await assign("record",[duplicate.id],b.email,true);
    expect(res.assigned).toBe(1); expect(res.reassigned).toBe(1);
    expect((await query("select assignee,state from bolna_assignments order by id")).rows).toEqual([{assignee:a.email,state:"dropped"},{assignee:b.email,state:"open"}]);
  });
  it("does not let reopening completed work bypass contact ownership", async () => {
    const r=await listing(); const duplicate=await listing();
    await assign("record",[r.id]);
    const id=(await query("select id from bolna_assignments")).rows[0].id;
    await seedConnectedCalls();
    await query("update bolna_assignments set state='done',outcome='Unavailable'");
    await assign("record",[duplicate.id],b.email);
    await expect(updateAssignment(id,admin,{state:"open",revision:0})).rejects.toThrow();
    expect((await query("select count(*) n from bolna_assignments where state='open'")).rows[0].n).toBe("1");
  });
  it("excludes cross-channel shared contacts from Unassigned, including exports", async () => {
    const r=await listing(); const duplicate=await listing(); const c=await call(r.phoneId);
    await assign("record",[r.id]);
    expect((await getCalls(admin,{assignee:"none"})).total).toBe(0);
    expect((await getRawRecords(admin,{assignee:"none"})).total).toBe(0);
    expect((await getCalls(admin,{})).rows[0].assigned_to).toBe(a.email);
    expect((await getRawRecords(admin,{})).rows.find(row=>row.id===duplicate.id)?.assigned_to).toBe(a.email);
    expect((await getCallIds(admin,{assignee:"none"},100)).ids).not.toContain(c);
  });
  it("shares related source properties with the task owner without exposing other callers' history", async () => {
    const r=await listing(); const duplicate=await listing(); await listing("9876543219","Unrelated");
    await assign("record",[r.id]);
    expect((await getRelatedListings(a,"record",r.id)).map(row=>row.id).sort()).toEqual([r.id,duplicate.id].sort());
    expect(await getRelatedListings(b,"record",r.id)).toEqual([]);
    expect((await getRawRecords(a,{})).total).toBe(1);
  });
  it("preserves same-owner legacy episodes until all open contact ownership is released", async () => {
    const r=await listing(); const c=await call(r.phoneId);
    await query("insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by) values ('record',$1,$3,$4),('call',$2,$3,$4)",[r.id,c,a.email,admin.email]);
    await seedConnectedCalls();
    await query("update bolna_assignments set state='done',outcome='Unavailable' where entity_type='record'");
    expect((await query("select count(*) n from bolna_open_owners_for_phones(ARRAY['9876543210'])")).rows[0].n).toBe("1");
    await query("update bolna_assignments set state='dropped' where entity_type='call'");
    expect((await query("select count(*) n from bolna_open_owners_for_phones(ARRAY['9876543210'])")).rows[0].n).toBe("0");
  });
  it("guards concurrent direct inserts as well as the allocation service", async () => {
    const r=await listing(); const duplicate=await listing();
    const writes=await Promise.allSettled([[r.id,a.email],[duplicate.id,b.email]].map(([id,owner])=>query("insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by) values ('record',$1,$2,$3)",[id,owner,admin.email])));
    expect(writes.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    expect((await query("select count(*) n from bolna_assignments")).rows[0].n).toBe("1");
  });
  it("repairs stale contact claims after source phone corrections without allowing cross-owner work", async()=>{
    const old=await listing('9876543210'); const other=await listing('9876543219');
    await assign('record',[old.id]);
    await query('update raw_phones set phone_id=$1 where master_id=$2',[other.phoneId,old.id]);
    const fresh=await listing('9876543210');
    expect((await assign('record',[fresh.id],b.email)).assigned).toBe(1);
    await expect(query("insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by) values ('record',$1,$2,$3)",[other.id,b.email,admin.email])).rejects.toThrow('already assigned');
    expect((await getRawRecords(admin,{assignment_state:'unassigned'})).total).toBe(0);
  });
  it("normalizes inbound customer numbers for cross-channel ownership", async () => {
    const r=await listing(); const c=await call(r.phoneId,"+918000000000");
    await query("update bolna_call_logs set call_type='inbound',from_number='09876543210' where id=$1",[c]);
    await assign("record",[r.id]);
    expect((await assign("call",[c],b.email)).assigned).toBe(0);
  });
  it("retains completed-history and never-assigned filters independently of current ownership", async () => {
    const r=await listing(); const fresh=await listing("9876543218");
    await seedLegacyAssignments("insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state,outcome) values ('record',$1,$2,$3,'done','Unavailable')",[r.id,a.email,admin.email]);
    expect((await getRawRecords(admin,{assignment_state:'done',assignee:a.email})).rows.map(row=>row.id)).toEqual([r.id]);
    expect((await getRawRecords(admin,{assignment_state:'never'})).rows.map(row=>row.id)).toEqual([fresh.id]);
  });
 });


describe("handoff B: reviewable and repeatable bulk allocation", () => {
  it("shows selected owners' manual status and completed outcomes alongside AI connection status", async()=>{
    const r=await listing(),c=await call(r.phoneId);
    await query("update bolna_call_logs set status='no-answer',llm_availability=null where id=$1",[c]);
    await seedLegacyAssignments("insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state,outcome) values('record',$1,$2,$3,'done','Unavailable')",[r.id,b.email,admin.email]);
    await assign('record',[r.id]);
    await query("update bolna_assignments set disposition='callback',outcome='Available',next_due_at='2026-10-12T03:00:00Z' where state='open'");
    const preview=await previewAssignment({entity:'record',ids:[r.id],assignee:b.email,assignedBy:admin.email});
    expect(preview.items[0].owners[0]).toMatchObject({assignee:a.email,state:'open',outcome:'Available',disposition:'callback'});
    expect(preview.items[0].owners[0].next_due_at).not.toBeNull();
    expect(preview.items[0].completed_by).toEqual([{assignee:b.email,state:'done',outcome:'Unavailable',disposition:null,count:1}]);
    expect(preview.items[0].ai).toMatchObject({execution_id:c,status:'no-answer',result:null,scope:'contact',known_attempts:0});
    expect(preview.aiStatuses).toEqual({'no-answer':1});
  });
  it("uses the selected execution's AI evidence, including calls with no contact number",async()=>{
    const r=await listing(),selected=await call(r.phoneId),newer=await call(r.phoneId);
    await query("update bolna_call_logs set status='completed',llm_availability=case when id=$1 then 'Available' else 'Unavailable' end,call_created_at=case when id=$1 then '2026-08-01'::timestamptz else '2026-08-02'::timestamptz end",[selected]);
    const options={entity:'call' as const,ids:[selected],assignee:a.email,assignedBy:admin.email};
    let item=(await previewAssignment(options)).items[0];
    expect(item.ai_result).toBe('Available');expect(item.ai).toMatchObject({execution_id:selected,scope:'execution'});
    await query('update bolna_call_logs set to_number=null,phone_id=null where id=$1',[selected]);
    item=(await previewAssignment(options)).items[0];expect(item.disposition).toBe('missing_phone');expect(item.ai).toMatchObject({execution_id:selected,result:'Available'});
    expect(item.ai?.execution_id).not.toBe(newer);
  });
  it("routine AI status updates do not invalidate ownership previews",async()=>{
    const r=await listing(),c=await call(r.phoneId);
    const options={entity:'record' as const,ids:[r.id],assignee:a.email,assignedBy:admin.email};
    const preview=await previewAssignment(options);
    await query("update bolna_call_logs set status='busy' where id=$1",[c]);
    expect((await assignEntities({...options,expectedPreview:preview.previewHash})).assigned).toBe(1);
    expect((await query('select count(*) n from bolna_assignments')).rows[0].n).toBe('1');
  });
  it("reconciles the preview, round-robin membership and final per-caller counts", async()=>{
    const rows=await Promise.all(Array.from({length:5},(_,i)=>listing(`987654321${i}`)));
    const opts={entity:"record" as const,ids:rows.map(row=>row.id),assignees:[b.email,a.email],assignedBy:admin.email};
    const preview=await previewAssignment(opts);
    expect(preview.eligible).toBe(5); expect(preview.perCaller).toEqual({[a.email]:3,[b.email]:2});
    const result=await assignEntities({...opts,expectedPreview:preview.previewHash});
    expect(result.perCaller).toEqual(preview.perCaller);
    const members=(await query("select entity_id,assignee from bolna_assignment_batch_items where batch_id=$1 order by entity_id",[result.batchId])).rows;
    expect(members).toEqual(preview.items.map(item=>({entity_id:item.id,assignee:item.assignee})));
  });
  it("replays the same intent exactly once, even after its assignments finish",async()=>{
    const r=await listing(); const opts={entity:"record" as const,ids:[r.id],assignee:a.email,assignedBy:admin.email,intentKey:randomUUID()};
    const first=await assignEntities(opts);
    await seedConnectedCalls();
    await query("update bolna_assignments set state='done',outcome='Unavailable'");
    expect(await assignEntities(opts)).toEqual(first);
    expect((await query("select count(*) n from bolna_assignment_batches")).rows[0].n).toBe('1');
    expect((await query("select count(*) n from bolna_assignments")).rows[0].n).toBe('1');
  });
  it("rejects reuse of an intent key with a different payload",async()=>{
    const r=await listing(); const opts={entity:"record" as const,ids:[r.id],assignee:a.email,assignedBy:admin.email,intentKey:randomUUID()};
    await assignEntities(opts);
    await expect(assignEntities({...opts,note:'Different request'})).rejects.toThrow('different request');
  });
  it("serializes concurrent retries into one durable batch",async()=>{
    const r=await listing(); const opts={entity:"record" as const,ids:[r.id],assignee:a.email,assignedBy:admin.email,intentKey:randomUUID()};
    const results=await Promise.all([assignEntities(opts),assignEntities(opts),assignEntities(opts)]);
    expect(new Set(results.map(r=>r.batchId)).size).toBe(1);
    expect((await query("select count(*) n from bolna_assignment_batch_items")).rows[0].n).toBe('1');
  });
  it("refuses a stale preview without taking new ownership",async()=>{
    const r=await listing(); const opts={entity:"record" as const,ids:[r.id],assignee:b.email,assignedBy:admin.email,reassign:true};
    const preview=await previewAssignment(opts);
    await assign('record',[r.id],a.email);
    await expect(assignEntities({...opts,expectedPreview:preview.previewHash})).rejects.toThrow('Review the refreshed preview');
    expect((await query("select assignee from bolna_assignments where state='open'")).rows[0].assignee).toBe(a.email);
  });
  it("checks caller activity again at commit",async()=>{
    const r=await listing(); const opts={entity:"record" as const,ids:[r.id],assignee:a.email,assignedBy:admin.email};
    const preview=await previewAssignment(opts);
    await query("update bolna_app_users set active=false where email=$1",[a.email]);
    await expect(assignEntities({...opts,expectedPreview:preview.previewHash})).rejects.toThrow('active user');
    expect((await query("select count(*) n from bolna_assignment_batches")).rows[0].n).toBe('0');
  });
  it("reports invalid phones and duplicate contacts without allocating them",async()=>{
    const r=await listing(),dup=await listing(),missing=randomUUID();
    await query("insert into raw_records(id,source,source_record_id) values($1::uuid,'fixture',$1::text)",[missing]);
    const opts={entity:'record' as const,ids:[r.id,dup.id,missing],assignee:a.email,assignedBy:admin.email};
    const preview=await previewAssignment(opts);
    expect(preview).toMatchObject({requested:3,validPhones:2,uniquePhones:1,duplicateContacts:1,missingPhone:1,eligible:1});
    expect(await assignEntities({...opts,expectedPreview:preview.previewHash})).toMatchObject({assigned:1,skipped:2,duplicateContacts:1,skippedNoPhone:1});
  });
  it("keeps batch membership stable after a later reassignment",async()=>{
    const r=await listing(); const old=await assign('record',[r.id]);
    const next=await assign('record',[r.id],b.email,true);
    expect(old.batchId).not.toBe(next.batchId);
    expect((await query("select i.assignee,a.state from bolna_assignment_batch_items i join bolna_assignments a on a.id=i.assignment_id where i.batch_id=$1",[old.batchId])).rows).toEqual([{assignee:a.email,state:'dropped'}]);
  });
});


it("handoff B: workload counts use IST midnight and exclude invalid completions",async()=>{
  const r=await listing();
  for(const at of ['2026-10-09T18:29:59Z','2026-10-09T18:30:00Z','2026-10-10T18:29:59Z','2026-10-10T18:30:00Z'])
    await seedLegacyAssignments("insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state,outcome,completed_at) values('record',$1,$2,$3,'done','Unavailable',$4)",[r.id,a.email,admin.email,at]);
  await assign('record',[r.id]);
  const workloads=await getAssigneeWorkloads(new Date('2026-10-10T10:00:00Z'));
  expect(workloads.find(row=>row.email===a.email)).toMatchObject({open:1,manual_open:1,ai_open:0,done_today:2});
});

it('diagnostic query profiling',async()=>{
  const r=await listing();const c=await call(r.phoneId);
  await seedLegacyAssignments("insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state,outcome) values('call',$1,$2,$3,'done','Unavailable')",[c,a.email,admin.email]);
  await seedLegacyAssignments("insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state,outcome) values('record',$1,$2,$3,'done','Unavailable')",[r.id,a.email,admin.email]);
  const plans:Record<string,unknown>={};
  for(const [label,spec] of [['calls',callsExportQuery(admin,{assignee:'none'})],['raw',rawExportQuery(admin,{assignee:'none'})]] as const){
    const plan=(await query(`explain (analyze,buffers,format json) ${spec.sql.replace("null::jsonb as raw_matches","raw_matches")} limit 25`,spec.params)).rows[0]['QUERY PLAN'];
    plans[label]=plan;
    console.log(label,JSON.stringify({execution:plan[0]['Execution Time'],planning:plan[0]['Planning Time'],jit:plan[0].JIT,cost:plan[0].Plan['Total Cost']}));
  }
  const fs=await import('node:fs/promises');await fs.writeFile('/tmp/bolna-handoff-query-plans.json',JSON.stringify(plans,null,2));
},30000);

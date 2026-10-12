import { beforeAll, beforeEach, afterAll, afterEach, describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { getPool, query } from "@/lib/db";
import { assignEntities, updateAssignment, dropAssignment } from "@/lib/assignments";
import { getCalls, getCallIds, callsExportQuery } from "@/lib/calls";
import { getRawRecords, getRawRecordIds, rawExportQuery } from "@/lib/raw";
import { CONTACT_PHONES_SQL } from "@/lib/assignment-contacts";
import { normNum } from "@/lib/queue";
import { POST as assignRoute } from "@/app/api/assignments/route";
import { PATCH as patchRoute } from "@/app/api/assignments/[id]/route";

const auth = vi.hoisted(() => ({ user: { email: "admin@ownership.test", isAdmin: true, name: null } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => auth.user, getCurrentAdmin: async () => auth.user.isAdmin ? auth.user : null }));
const admin = { email: "admin@ownership.test", isAdmin: true, name: null };
const a = { email: "a@ownership.test", isAdmin: false, name: null };
const b = { email: "b@ownership.test", isAdmin: false, name: null };
const phone = "9811100001", other = "9811100002";

beforeAll(() => {
  if (!process.env.TEST_DATABASE_URL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.TEST_DATABASE_URL).hostname)) throw Error("Requires a disposable local test database");
});
beforeEach(async () => {
  await query("truncate bolna_assignments,bolna_app_users,bolna_call_logs,bolna_webhook_events,raw_records,raw_phones,raw_phone_numbers,call_batches,call_batch_items,bolna_dispatch_requests restart identity cascade");
  await query("insert into bolna_app_users(email,role) values ($1,'admin'),($2,'employee'),($3,'employee')", [admin.email,a.email,b.email]);
  auth.user = { ...admin };
  vi.stubGlobal("fetch", vi.fn(async () => { throw Error("Unexpected external HTTP request"); }));
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => { await getPool().end(); });

async function record(numbers: string[] = [phone]) {
  const id = randomUUID();
  await query("insert into raw_records(id,source,source_record_id,owner_name,city) values ($1::uuid,'ownership-test',$1::text,'Ownership fixture','Delhi')", [id]);
  for (const [i, number] of numbers.entries()) {
    const p = (await query(`insert into raw_phone_numbers(phone_last10,phone) values ($1,$2)
      on conflict(phone_last10) do update set phone=excluded.phone returning phone_id`, [normNum(number),number])).rows[0].phone_id;
    await query("insert into raw_phones(master_id,phone_id,is_primary) values ($1,$2,$3)", [id,p,i===0]);
  }
  return id;
}
async function call(number: string | null = phone, inbound = false, phoneId: string | null = null) {
  const id = randomUUID();
  await query("insert into bolna_call_logs(id,status,call_type,to_number,from_number,phone_id) values ($1,'completed',$2,$3,$4,$5)", [id,inbound?"inbound":"outbound",inbound?"+918000000000":number,inbound?number:"+918000000000",phoneId]);
  return id;
}
async function episode(entity: "record" | "call", entityId: string, owner = a.email, state = "open", remarks: string | null = null) {
  return (await query(`insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state,remarks)
    values ($1,$2,$3,$4,$5,$6) returning id::text`, [entity,entityId,owner,admin.email,state,remarks])).rows[0].id as string;
}
const assign = (entity: "record" | "call", ids: string[], assignee = a.email, reassign = false) => assignEntities({entity,ids,assignee,reassign,assignedBy:admin.email});
const post = (body: unknown) => assignRoute(new NextRequest("http://localhost/api/assignments", {method:"POST",body:JSON.stringify(body)}));
async function noOverlappingOpenWork() {
  const r=await query(`select p.phone_last10 from bolna_assignments a join (${CONTACT_PHONES_SQL}) p using(entity_type,entity_id)
    where a.state='open' group by p.phone_last10 having count(distinct a.assignee)>1`);
  expect(r.rows).toEqual([]);
}

describe("contact ownership filters", () => {
  it.each(["open","done"])("excludes %s work across alternate phones, call IDs and directions", async state => {
    const original=await record([other,"+91 98111 00001"]), duplicate=await record(["09811100001"]);
    const outbound=await call("+91-98111-00001"), inbound=await call(phone,true), unrelated=await record(["9811100003"]);
    await episode("record",original,a.email,state);
    expect((await getRawRecords(admin,{assignee:"none"})).rows.map(r=>r.id)).toEqual([unrelated]);
    expect((await getCalls(admin,{assignee:"none"})).total).toBe(0);
    expect(new Set((await getRawRecords(admin,{assignee:a.email})).rows.map(r=>r.id))).toEqual(new Set([original,duplicate]));
    expect(new Set((await getCalls(admin,{assignee:a.email})).rows.map(r=>r.id))).toEqual(new Set([outbound,inbound]));
    const display=(await getCalls(admin,{})).rows;
    expect(display.every(r=>r.assigned_to===a.email && r.assigned_state===state)).toBe(true);
    // A linked owner must not turn raw-row history into a different call's result.
    expect(display.every(r=>r.assignment_id===null && r.assignment_remarks===null && r.assignment_outcome===null)).toBe(true);
  });
  it("matches a completed call to its other calls and raw listings", async () => {
    const one=await call(), two=await call("+91"+phone), raw=await record();
    await episode("call",one,a.email,"done");
    expect((await getCalls(admin,{assignee:"none"})).total).toBe(0);
    expect((await getRawRecords(admin,{assignee:"none"})).total).toBe(0);
    expect((await getRawRecords(admin,{})).rows[0]).toMatchObject({id:raw,assigned_to:a.email,assigned_state:"done"});
    expect((await getCalls(admin,{})).rows.find(r=>r.id===two)?.assigned_to).toBe(a.email);
  });
  it("allows never-assigned and dropped-only contacts and their duplicates", async () => {
    const one=await record(), duplicate=await record(), ai=await call();
    await episode("record",one,a.email,"dropped");
    expect((await getRawRecords(admin,{assignee:"none"})).total).toBe(2);
    expect((await getCalls(admin,{assignee:"none"})).rows.map(r=>r.id)).toEqual([ai]);
    expect((await getRawRecords(admin,{})).rows.every(r=>!r.assigned_to)).toBe(true);
    expect([one,duplicate]).toHaveLength(2);
  });
  it("keeps a completed owner excluded when a newer assignment is dropped", async () => {
    const raw=await record(), ai=await call();
    await episode("call",ai,a.email,"done");await episode("record",raw,b.email,"dropped");
    expect((await getRawRecords(admin,{assignee:"none"})).total).toBe(0);
    expect((await getCalls(admin,{assignee:"none"})).total).toBe(0);
  });
  it("uses exact-entity ownership even when an old assignment has no phone", async () => {
    const raw=await record([]), ai=await call(null), otherRaw=await record([]), otherCall=await call(null);
    await episode("record",raw,a.email,"done");await episode("call",ai,a.email,"done");
    expect((await getRawRecords(admin,{assignee:"none"})).rows.map(r=>r.id)).toEqual([otherRaw]);
    expect((await getCalls(admin,{assignee:"none"})).rows.map(r=>r.id)).toEqual([otherCall]);
  });
  it("does not join different missing/invalid phone numbers together", async () => {
    const one=await call("123"),two=await call("123"), raw=await record(["123"]);
    await episode("call",one);
    expect((await getCalls(admin,{assignee:"none"})).rows.map(r=>r.id)).toEqual([two]);
    expect((await getRawRecords(admin,{assignee:"none"})).rows.map(r=>r.id)).toEqual([raw]);
  });
  it("uses a retained phone_id if the provider number is absent", async () => {
    const raw=await record();const p=(await query("select phone_id from raw_phone_numbers")).rows[0].phone_id;
    const ai=await call(null,false,p);await episode("call",ai);
    expect((await getRawRecords(admin,{assignee:"none"})).total).toBe(0);
    expect((await getRawRecords(admin,{})).rows[0].id).toBe(raw);
    expect((await assign("record",[raw],b.email)).skippedOwned).toBe(1);
  });
  it("keeps paged counts, export queries and all-matching ID sets consistent", async () => {
    const owned=await record(), duplicate=await record(), free=await record([other]);
    const ownedCall=await call(),freeCall=await call(other);await episode("record",owned,a.email,"done");
    const rawPage=await getRawRecords(admin,{assignee:"none",pageSize:1,page:2});
    const rawIds=await getRawRecordIds(admin,{assignee:"none"},20), callIds=await getCallIds(admin,{assignee:"none"},20);
    const rawSpec=rawExportQuery(admin,{assignee:"none"}),callSpec=callsExportQuery(admin,{assignee:"none"});
    expect(rawPage).toMatchObject({total:1,page:1,pages:1});expect(rawIds.ids).toEqual([free]);expect(callIds.ids).toEqual([freeCall]);
    expect((await query(rawSpec.sql,rawSpec.params)).rows.map(r=>r.id)).toEqual([free]);
    expect((await query(callSpec.sql,callSpec.params)).rows.map(r=>r.id)).toEqual([freeCall]);
    expect([duplicate,ownedCall]).toHaveLength(2);
  });
  it("keeps employee visibility and private notes tied to their actual assignments", async () => {
    const raw=await record(), ai=await call(), duplicate=await call("+91"+phone);
    await episode("call",ai,a.email,"done","A private history");await episode("record",raw,b.email,"open","B private notes");
    const rows=(await getCalls(a,{assignee:b.email})).rows;
    expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({id:ai,assigned_to:a.email,assignment_remarks:"A private history"});
    expect(rows.some(r=>r.id===duplicate)).toBe(false);
    expect((await getRawRecords(a,{})).total).toBe(0);
  });
  it("collapses repeated completed history before matching other rows of the same phone", async () => {
    const raw=await record(),free=await call(other);
    await query(`insert into bolna_call_logs(id,status,to_number)
      select gen_random_uuid(),'completed',$1 from generate_series(1,2000)`,[phone]);
    await query(`insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state)
      select 'call',id,$1,$2,'done' from bolna_call_logs where to_number=$3 limit 1000`,[a.email,admin.email,phone]);
    expect((await getCalls(admin,{assignee:"none"})).rows.map(r=>r.id)).toEqual([free]);
    expect((await getRawRecords(admin,{assignee:"none"})).total).toBe(0);
    expect((await getRawRecords(admin,{assignee:a.email})).rows.map(r=>r.id)).toEqual([raw]);
  });
});

describe("phone-aware assignment writes", () => {
  it("deduplicates repeated call IDs by normalized phone and retains distinct contacts", async () => {
    const ids=await Promise.all([phone,"+91 "+phone,"0"+phone,other].map(p=>call(p)));
    expect(await assign("call",ids)).toMatchObject({requested:4,assigned:2,duplicateContacts:2,skipped:2});
    expect((await query("select count(*)::int n from bolna_assignments")).rows[0].n).toBe(2);
  });
  it("deduplicates a selection through an alternate phone", async () => {
    const one=await record([other,phone]),two=await record([phone]);
    expect(await assign("record",[one,two])).toMatchObject({assigned:1,duplicateContacts:1});
  });
  it.each(["record","call"] as const)("skips %s contacts owned through the other channel", async entity => {
    const raw=await record([other,phone]),ai=await call();
    await episode(entity==="record"?"call":"record",entity==="record"?ai:raw);
    expect(await assign(entity,[entity==="record"?raw:ai],b.email)).toMatchObject({assigned:0,skippedOwned:1});
    await noOverlappingOpenWork();
  });
  it("does not create another task for the current caller or for completed work", async () => {
    const one=await call(),two=await call();await episode("call",one,a.email,"done");
    expect(await assign("call",[two],a.email)).toMatchObject({assigned:0,skippedOwned:1});
    expect(await assign("call",[two],b.email)).toMatchObject({assigned:0,skippedOwned:1});
    expect(await assign("call",[two],b.email,true)).toMatchObject({assigned:1,reassigned:0});
    expect(await assign("call",[one],b.email,true)).toMatchObject({assigned:0,skippedOwned:1});
    expect((await query("select state from bolna_assignments where entity_id=$1",[one])).rows[0].state).toBe("done");
  });
  it("transfers all overlapping open work while preserving notes and completed history", async () => {
    const raw=await record([other,phone]),first=await call(),second=await call(other),target=await call();
    const old=await episode("record",raw,a.email,"open","Keep source notes"),oldCall=await episode("call",first,a.email,"open","Keep call notes");
    const history=await episode("call",second,a.email,"done","Keep completed history");
    expect(await assign("call",[target],b.email,true)).toMatchObject({assigned:1,reassigned:2});
    expect((await query("select id::text,state,remarks from bolna_assignments where id=any($1::bigint[]) order by id",[[old,oldCall,history]])).rows).toEqual([
      {id:old,state:"dropped",remarks:"Keep source notes"},{id:oldCall,state:"dropped",remarks:"Keep call notes"},{id:history,state:"done",remarks:"Keep completed history"},
    ]);await noOverlappingOpenWork();
  });
  it("keeps the selected caller's task and removes a legacy competing owner on explicit reassignment", async () => {
    const raw=await record(), ai=await call(), target=await call();
    const kept=await episode("record",raw,b.email),removed=await episode("call",ai,a.email);
    expect(await assign("call",[target],b.email,true)).toMatchObject({assigned:0,reassigned:1,skippedOwned:1});
    expect((await query("select id::text,state from bolna_assignments order by id")).rows).toEqual([{id:kept,state:"open"},{id:removed,state:"dropped"}]);
    await noOverlappingOpenWork();
  });
  it("allows dropped contacts to be assigned again and rejects missing/invalid phones", async () => {
    const raw=await record(),bad=await record(["123"]),missing=await record([]);await episode("record",raw,a.email,"dropped");
    expect(await assign("record",[raw,bad,missing],b.email)).toMatchObject({assigned:1,skippedNoPhone:2});
    expect(await assign("call",[await call(null),await call("123")],b.email)).toMatchObject({assigned:0,skippedNoPhone:2});
  });
  it("resolves all-matching API selections using the same contact filter", async () => {
    const raw=await record(),free=await record([other]);await episode("call",await call(),a.email,"done");
    const response=await post({entity_type:"record",assignee:b.email,filters:{assignee:"none"}});
    expect(response.status).toBe(200);expect(await response.json()).toMatchObject({assigned:1,requested:1});
    expect((await query("select entity_id from bolna_assignments where entity_type='record'")).rows).toEqual([{entity_id:free}]);
    expect(raw).not.toBe(free);
  });
  it("returns useful skip counts through the real assignment API", async () => {
    const owned=await call(),duplicate=await call(),free1=await call(other),free2=await call(other),invalid=await call("123");await episode("call",owned);
    const response=await post({entity_type:"call",assignee:b.email,ids:[duplicate,free1,free2,invalid]});
    expect(response.status).toBe(200);expect(await response.json()).toMatchObject({assigned:1,skippedOwned:1,duplicateContacts:1,skippedNoPhone:1,skipped:3});
  });
  it("rejects employee allocation and rolls back invalid target reassignment", async () => {
    const raw=await record(),id=await episode("record",raw);auth.user={...a};
    expect((await post({entity_type:"record",assignee:b.email,ids:[raw]})).status).toBe(403);
    await expect(assign("record",[raw],"missing@ownership.test",true)).rejects.toMatchObject({status:400});
    expect((await query("select state from bolna_assignments where id=$1",[id])).rows[0].state).toBe("open");
  });
  it("rechecks imported alternate numbers on the next assignment", async () => {
    const raw=await record([other]);await assign("record",[raw]);
    const p=(await query("insert into raw_phone_numbers(phone_last10,phone) values ($1,$1) returning phone_id",[phone])).rows[0].phone_id;
    await query("insert into raw_phones(master_id,phone_id) values ($1,$2)",[raw,p]);
    const ai=await call();expect(await assign("call",[ai],b.email)).toMatchObject({assigned:0,skippedOwned:1});
    expect((await getCalls(admin,{assignee:"none"})).total).toBe(0);
  });
  it("handles the 20,000-row assignment limit without giving duplicate numbers more work", async () => {
    const ids=(await query(`insert into bolna_call_logs(id,status,call_type,to_number)
      select gen_random_uuid(),'completed','outbound','+91'||'9'||lpad((n%10000)::text,9,'0')
      from generate_series(1,20000) n returning id`)).rows.map(r=>r.id as string);
    await query("analyze bolna_call_logs");
    const start=Date.now();
    expect(await assign("call",ids)).toMatchObject({requested:20000,assigned:10000,duplicateContacts:10000,skipped:10000,capped:false});
    console.log(`20,000-row contact allocation: ${Date.now()-start} ms`);
    await query("analyze bolna_assignments");
    // Independent oracle: every active call task has a distinct dialable number.
    expect((await query(`select count(*)::int tasks,count(distinct c.phone_last10)::int phones
      from bolna_assignments a join bolna_call_logs c on a.entity_type='call' and a.entity_id=c.id
      where a.state='open'`)).rows[0]).toEqual({tasks:10000,phones:10000});
    const retry=Date.now();
    expect(await assign("call",ids,b.email)).toMatchObject({assigned:0,skippedOwned:20000,skipped:20000});
    console.log(`20,000-row already-owned allocation: ${Date.now()-retry} ms`);
  },30000);
});

describe("concurrency and reopening", () => {
  it("serializes simultaneous assignments of different row IDs sharing a phone", async () => {
    const raw=await record([other,phone]),ai=await call(),duplicate=await record();
    const results=await Promise.all([assign("record",[raw],a.email),assign("call",[ai],b.email),assign("record",[duplicate],b.email)]);
    expect(results.reduce((sum,r)=>sum+r.assigned,0)).toBe(1);await noOverlappingOpenWork();
  });
  it("serializes bulk requests with reversed overlapping selections", async () => {
    const first=await record([phone,other]),second=await record([other,"9811100003"]);
    const results=await Promise.all([assign("record",[first,second],a.email),assign("record",[second,first],b.email)]);
    expect(results.reduce((sum,r)=>sum+r.assigned,0)).toBe(1);await noOverlappingOpenWork();
  });
  it("rejects reopening completed work when another caller owns a linked number", async () => {
    const raw=await record(),ai=await call(),id=await episode("record",raw,a.email,"done");await episode("call",ai,b.email);
    auth.user={...a};
    const response=await patchRoute(new NextRequest("http://localhost",{method:"PATCH",body:JSON.stringify({state:"open",revision:0})}),{params:Promise.resolve({id})});
    expect(response.status).toBe(409);expect(await response.json()).toMatchObject({error:expect.stringContaining("phone number")});
    expect((await query("select state from bolna_assignments where id=$1",[id])).rows[0].state).toBe("done");
  });
  it("allows reopening once competing work has been dropped", async () => {
    const raw=await record(),ai=await call(),id=await episode("record",raw,a.email,"done"),competitor=await episode("call",ai,b.email);
    await dropAssignment(competitor);expect(await updateAssignment(id,a,{state:"open",revision:0})).toMatchObject({state:"open",revision:1});
  });
  it("serializes a reopen against a simultaneous explicit reassignment", async () => {
    const raw=await record(),ai=await call(),id=await episode("record",raw,a.email,"done");
    await Promise.allSettled([updateAssignment(id,a,{state:"open",revision:0}),assign("call",[ai],b.email,true)]);
    expect((await query("select assignee from bolna_assignments where state='open'")).rows).toEqual([{assignee:b.email}]);await noOverlappingOpenWork();
  });
  it("does not make normal notes or Done wait for the allocation lock", async () => {
    const raw=await record(),id=await episode("record",raw);const blocker=await getPool().connect();
    try {
      await blocker.query("begin");await blocker.query("select pg_advisory_xact_lock(81620404)");
      expect(await updateAssignment(id,a,{remarks:"Normal notes still save",revision:0})).toMatchObject({revision:1});
      expect(await updateAssignment(id,a,{state:"done",outcome:"Available",whId:"12345",revision:1})).toMatchObject({state:"done"});
      expect((await getRawRecords(admin,{assignee:"none"})).total).toBe(0);
    } finally {await blocker.query("rollback");blocker.release();}
  },5000);
  it("reopening preserves stale-write and ownership checks", async () => {
    const id=await episode("call",await call(),a.email,"done");
    await expect(updateAssignment(id,b,{state:"open",revision:0})).rejects.toMatchObject({status:409});
    await expect(updateAssignment(id,a,{state:"open",revision:4})).rejects.toMatchObject({status:409});
    expect(await updateAssignment(id,a,{state:"open",remarks:"Reopened with notes",revision:0})).toMatchObject({state:"open",remarks:"Reopened with notes"});
  });
});

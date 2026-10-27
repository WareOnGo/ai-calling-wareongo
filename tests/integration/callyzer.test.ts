import { beforeAll,beforeEach,afterAll,it,expect,vi } from "vitest";
import { NextRequest } from "next/server";
import { getPool,query } from "@/lib/db";
import * as database from "@/lib/db";
import { syncCallyzer } from "@/lib/callyzer-sync";
import { CallyzerError,type CallyzerRequest,type CallyzerResponse } from "@/lib/callyzer-client";
import { callyzerReport,callyzerHistory,parseActivityFilters } from "@/lib/callyzer-report";
import { parseTeamFilters } from "@/lib/team-report";
import { upsertUser } from "@/lib/users";
import { POST as usersApi } from "@/app/api/users/route";
import { POST as workerApi } from "@/app/api/callyzer/sync/route";

const auth = vi.hoisted(() => ({admin:true}));
vi.mock("@/lib/auth",() => ({getCurrentAdmin:async () => auth.admin ? {email:"admin@callyzer.test",isAdmin:true} : null}));
const admin = {email:"admin@callyzer.test",isAdmin:true},caller = "caller@callyzer.test",other = "other@callyzer.test";
const number = "91-9876543210",start = "2026-01-01";
const activity = parseActivityFilters({}), filters = parseTeamFilters({date_from:"2026-10-26",date_to:"2026-10-26"});
const call = (id: string,extra: Record<string,unknown> = {}) => ({id,emp_country_code:"91",emp_number:"9876543210",client_country_code:"91",client_number:"9811100001",client_name:"Fixture contact",duration:"20",call_type:"Outgoing",call_date:"2026-10-26",call_time:"10:00:00",synced_at:"2026-10-26 10:05:00 IST",modified_at:null,...extra});
async function link(email = caller) { await upsertUser({email,callyzer_number:number,callyzer_since:start}); }
function historyResponse(body: Record<string,unknown>,response: CallyzerResponse): CallyzerResponse {
  const size = response.page_size ?? 99, page = Number(body.page_no);
  return {page_no:page,page_size:size,total_records:(page-1)*size+response.result.length,...response};
}
function runner(request: CallyzerRequest,maxRequests = 12) {
  let clock = Date.now();
  return syncCallyzer({request:async (path,body) => {
    const response = await request(path,body);
    return path === "call-log/history" ? historyResponse(body,response) : response;
  },now:() => clock,sleep:async ms => {clock += ms;},maxRequests});
}
const empty: CallyzerRequest = async () => ({result:[],page_size:99});
beforeAll(() => { if (new URL(process.env.TEST_DATABASE_URL!).hostname !== "127.0.0.1") throw Error("Disposable local database required"); });
beforeEach(async () => {
  vi.stubEnv("CALLYZER_API_TOKEN","test-only");vi.stubEnv("CALLYZER_ACCOUNT_KEY","callyzer-test");auth.admin = true;
  await query("truncate callyzer_sync_state,bolna_app_users restart identity cascade");
  await query("insert into bolna_app_users(email,role) values($1,'admin'),($2,'employee'),($3,'employee')",[admin.email,caller,other]);
});
afterAll(async () => {vi.unstubAllEnvs();await getPool().end();});

it("excludes admin accounts and their calls from performance and caller history",async () => {
  await link(admin.email);
  await runner(async (path,body) => path === "employee/get" ? {result:[]} : {result:body.call_method === "PhoneCall" ? [call("admin-call")] : [],page_size:99});
  const report=await callyzerReport(admin,filters,activity);
  expect(report.people.map(p=>p.email)).toEqual([caller,other]);
  expect(report.people.reduce((sum,p)=>sum+p.calls,0)).toBe(0);
  expect((await callyzerHistory(admin,filters,{...activity,activity_caller:admin.email}))?.total).toBe(0);
  expect((await query("select count(*)::int n from callyzer_calls")).rows[0].n).toBe(1);
});

it("imports all channels, deduplicates overlaps, and captures late uploads by sync time",async () => {
  await link();
  const requests: Record<string,unknown>[] = [];
  const provider: CallyzerRequest = async (path,body) => {
    requests.push({path,...body});
    if (path === "employee/get") return {result:[{emp_country_code:"91",emp_number:"9876543210",last_sync_req_at:"2026-10-26 12:00:00 IST"}]};
    return {result:[call(`${body.call_method}:${body.call_mode}`)],page_size:99,page_no:body.page_no as number};
  };
  expect(await runner(provider)).toMatchObject({status:"current",calls:3});
  expect(requests.find(r => r.path === "employee/get")).toMatchObject({emp_numbers:[number]});
  expect(requests.filter(r => r.path === "call-log/history").every(r => typeof r.call_from === "number" && Number(r.call_to) - r.call_from < 180*86400)).toBe(true);
  await query("update callyzer_sync_state set next_request_at=null,streams=jsonb_set(streams,'{phone,through}',to_jsonb(extract(epoch from now()-interval '5 minutes')::bigint))");
  const incremental: CallyzerRequest = async (path,body) => {
    expect(path).toBe("call-log/history");expect(body.synced_from).toBeTypeOf("number");expect(body.call_from).toBeUndefined();
    return {result:body.call_method === "PhoneCall" ? [call("PhoneCall:Voice"),call("late",{call_date:"2026-01-02"})] : [],page_size:99};
  };
  expect(await runner(incremental)).toMatchObject({status:"current"});
  expect((await query("select count(*)::int n from callyzer_calls")).rows[0].n).toBe(4);
  expect((await query("select caller_email from callyzer_calls where source_id='late'")).rows[0].caller_email).toBe(caller);
  expect((await query("select count(*)::int n from bolna_manual_attempts")).rows[0].n).toBe(0);
});

it("commits pages atomically, resumes the failed page, honors returned page size and backoff",async () => {
  const provider: CallyzerRequest = async (_path,body) => {
    if (body.call_method === "PhoneCall" && body.page_no === 1) return {result:[call("p1"),call("p2")],page_size:2,page_no:1};
    if (body.call_method === "PhoneCall") throw new CallyzerError("Callyzer HTTP 429",120000,429);
    return {result:[],page_size:2};
  };
  expect(await runner(provider)).toMatchObject({status:"retry_scheduled",calls:2});
  const saved = (await query("select streams,failures,next_attempt_at>now() backed_off from callyzer_sync_state")).rows[0];
  expect(saved).toMatchObject({failures:1,backed_off:true,streams:{phone:{window:{page:2},backfilled:false}}});
  expect(await runner(provider)).toMatchObject({status:"busy_or_backoff"});
  await query("update callyzer_sync_state set next_attempt_at=null,next_request_at=null");
  const resumed: Record<string,unknown>[] = [];
  expect(["current","in_progress"]).toContain((await runner(async (_path,body) => {resumed.push(body);return {result:[],page_size:2};})).status);
  // A later invocation can also open page 1 of a newer sync window after resuming page 2.
  expect(resumed[0]).toMatchObject({page_no:2,call_from:saved.streams.phone.window.from,call_to:saved.streams.phone.window.to});
  expect((await query("select count(*)::int n from callyzer_calls")).rows[0].n).toBe(2);
});

it("refuses invalid/repeated pages without advancing coverage or committing partial rows",async () => {
  let round = 0;
  expect(await runner(async (_path,body) => {
    if (body.call_method !== "PhoneCall") return {result:[],page_size:2};
    round++;
    return {result:[call("same1"),call("same2")],page_size:2};
  })).toMatchObject({status:"retry_scheduled",calls:2});
  expect(round).toBe(2);
  expect((await query("select streams->'phone'->'window'->>'page' page from callyzer_sync_state")).rows[0].page).toBe("2");
  await query("update callyzer_sync_state set next_attempt_at=null,next_request_at=null");
  expect(await runner(async () => ({result:[call("valid"),call("bad",{call_date:"2026-02-30"})],page_size:99}))).toMatchObject({status:"retry_scheduled",calls:0});
  expect((await query("select count(*)::int n from callyzer_calls where source_id='valid'")).rows[0].n).toBe(0);
});

it("fences expired leases and suppresses concurrent workers",async () => {
  let entered!: () => void,release!: () => void;
  const ready = new Promise<void>(resolve => {entered = resolve;});
  const barrier = new Promise<void>(resolve => {release = resolve;});
  const first = runner(async () => {entered();await barrier;return {result:[call("late-worker")],page_size:99};},1);
  await ready;
  expect(await runner(empty)).toMatchObject({status:"busy_or_backoff"});
  await query("update callyzer_sync_state set lease_until=now()-interval '1 second'");
  expect(["current","in_progress"]).toContain((await runner(empty)).status);
  release();
  expect(await first).toMatchObject({status:"lease_lost"});
  expect((await query("select count(*)::int n from callyzer_calls")).rows[0].n).toBe(0);
});

it("keeps original attribution after unlinking, and links only eligible unassigned history",async () => {
  await runner(async (_path,body) => ({result:body.call_method === "PhoneCall" ? [call("old"),call("before-start",{call_date:"2025-12-01"})] : [],page_size:99}));
  await link();
  expect((await query("select caller_email from callyzer_calls where source_id='old'")).rows[0].caller_email).toBe(caller);
  expect((await query("select caller_email from callyzer_calls where source_id='before-start'")).rows[0].caller_email).toBe(null);
  await expect(link(other)).rejects.toThrow("already linked");
  await upsertUser({email:caller,role:"admin"});
  expect((await query("select callyzer_number from bolna_app_users where email=$1",[caller])).rows[0].callyzer_number).toBe(number);
  await upsertUser({email:caller,callyzer_number:null,callyzer_since:null});await link(other);
  expect((await query("select caller_email from callyzer_calls where source_id='old'")).rows[0].caller_email).toBe(caller);
});

it("does not let an invalid employee link block the account's history import",async () => {
  await link();
  expect(await runner(async (path,body) => {
    if (path === "employee/get") throw new CallyzerError("Callyzer HTTP 400",0,400);
    return {result:body.call_method === "PhoneCall" ? [call("ok")] : [],page_size:99};
  })).toMatchObject({status:"current",calls:1});
  expect((await query("select callyzer_device from bolna_app_users where email=$1",[caller])).rows[0].callyzer_device).toMatchObject({found:null,error:"Callyzer HTTP 400"});
});

it("reports IST dates, channel filters, missing durations and caller history independently of manual outcomes",async () => {
  await link();
  await runner(async (path,body) => path === "employee/get" ? {result:[]} : {result:body.call_method === "PhoneCall" ? [
    call("midnight",{call_time:"00:00:00"}),call("end",{call_time:"23:59:59",duration:"2"}),
    call("tomorrow",{call_date:"2026-10-27"}),call("unknown",{duration:null}),call("missed",{duration:0,call_type:"Missed"}),
  ] : body.call_mode === "Video" ? [call("video",{duration:60})] : [],page_size:99});
  const result = await callyzerReport(admin,filters,activity);
  expect(result.people.find(p => p.email === caller)).toMatchObject({calls:5,connected:2,talk_seconds:80,unknown_durations:1});
  expect((await callyzerReport(admin,filters,{...activity,activity_channel:"phone"})).people.find(p => p.email === caller)?.calls).toBe(4);
  expect((await callyzerHistory(admin,filters,{...activity,activity_caller:caller}))?.rows).toHaveLength(5);
  expect((await callyzerHistory(admin,{...filters,person:other},{...activity,activity_caller:caller}))?.total).toBe(0);
  expect((await callyzerHistory(admin,{...filters,access:"removed"},{...activity,activity_caller:caller}))?.total).toBe(0);
  expect((await callyzerReport(admin,{...filters,person:caller.toUpperCase()},activity)).people).toHaveLength(1);
  await expect(callyzerReport({email:caller,isAdmin:false},filters,activity)).rejects.toMatchObject({status:403});
  await expect(callyzerHistory({email:caller,isAdmin:false},filters,{...activity,activity_caller:caller})).rejects.toMatchObject({status:403});
});

it("protects caller writes and worker authentication, and validates link dates",async () => {
  const post = (body: unknown) => usersApi(new NextRequest("http://localhost/api/users",{method:"POST",body:JSON.stringify(body)}));
  auth.admin = false;expect((await post({email:caller,callyzer_number:number,callyzer_since:start})).status).toBe(403);
  auth.admin = true;
  expect((await post({email:caller,callyzer_number:number})).status).toBe(400);
  expect((await post({email:caller,callyzer_number:number,callyzer_since:"2999-01-01"})).status).toBe(400);
  expect((await post({email:caller,callyzer_number:number,callyzer_since:start})).status).toBe(200);
  expect((await workerApi(new Request("http://localhost/api/callyzer/sync",{method:"POST"}))).status).toBe(401);
  vi.stubEnv("CALLYZER_API_TOKEN","");
  expect((await workerApi(new Request("http://localhost/api/callyzer/sync",{method:"POST",headers:{Authorization:`Bearer ${process.env.PROCESS_SECRET}`}}))).status).toBe(503);
});

it("spaces every provider request and protects newer call versions from stale overlap",async () => {
  let clock = Date.now();
  const starts: number[] = [];
  await syncCallyzer({now:() => clock,sleep:async ms => {clock += ms;},request:async (_path,body) => {
    starts.push(clock);
    return historyResponse(body,{result:body.call_method === "PhoneCall" ? [call("versioned",{modified_at:"2026-10-26 12:00:00 IST",duration:60})] : [],page_size:99});
  }});
  expect(starts).toHaveLength(3);
  // Fake sleep excludes real database time; enforce the provider's two-second floor.
  expect(starts.slice(1).every((at,index) => at-starts[index] >= 2000)).toBe(true);
  await query("update callyzer_sync_state set next_request_at=null,streams=jsonb_set(streams,'{phone,through}',to_jsonb(extract(epoch from now()-interval '5 minutes')::bigint))");
  await runner(async () => ({result:[call("versioned",{modified_at:"2026-10-26 11:00:00 IST",duration:3})],page_size:99}));
  expect((await query("select duration_seconds from callyzer_calls where source_id='versioned'")).rows[0].duration_seconds).toBe(60);
});

it("requires a complete caller link in the database and keeps imported tables private",async () => {
  await expect(query("update bolna_app_users set callyzer_tracking_since=now() where email=$1",[caller])).rejects.toMatchObject({code:"23514"});
  await expect(query("update bolna_app_users set callyzer_number=$2 where email=$1",[caller,number])).rejects.toMatchObject({code:"23514"});
  const tables = await query("select relname,relrowsecurity from pg_class where oid in ('callyzer_calls'::regclass,'callyzer_sync_state'::regclass)");
  expect(tables.rows).toHaveLength(2);expect(tables.rows.every(r => r.relrowsecurity)).toBe(true);
  const publicGrants = await query(`select count(*)::int n from pg_class c,aclexplode(c.relacl) a
    where c.oid in ('callyzer_calls'::regclass,'callyzer_sync_state'::regclass) and a.grantee=0`);
  expect(publicGrants.rows[0].n).toBe(0);
});

it("gives every channel a turn across slow cron invocations",async () => {
  let clock = Date.now();
  const seen: string[] = [];
  const request: CallyzerRequest = async (_path,body) => {
    seen.push(`${body.call_method}:${body.call_mode}`);
    clock += 11000;
    return {result:[],page_no:Number(body.page_no),page_size:99,total_records:0};
  };
  for (let run = 0; run < 3; run++) {
    await syncCallyzer({request,now:() => clock,sleep:async ms => {clock += ms;}});
    clock += 300000;
  }
  expect(new Set(seen)).toEqual(new Set(["PhoneCall:Voice","WhatsAppCall:Voice","WhatsAppCall:Video"]));
  expect((await query("select last_success_at from callyzer_sync_state")).rows[0].last_success_at).not.toBeNull();
});

it("keeps importing calls when optional employee metadata fails",async () => {
  await link();
  const result = await runner(async (path,body) => {
    if (path === "employee/get") throw new CallyzerError("Callyzer HTTP 500",0,500);
    return {result:body.call_method === "PhoneCall" ? [call("metadata-outage")] : [],page_no:Number(body.page_no),page_size:99,total_records:body.call_method === "PhoneCall" ? 1 : 0};
  });
  expect(result).toMatchObject({status:"current",calls:1});
  expect((await query("select callyzer_device from bolna_app_users where email=$1",[caller])).rows[0].callyzer_device).toMatchObject({found:null,error:"Callyzer HTTP 500"});
});

it.each([
  {result:[call("missing-pagination")]},
  {result:[call("short-page")],page_no:1,page_size:99,total_records:200},
])("does not advance coverage after a malformed pagination envelope: %j",async response => {
  const result = await syncCallyzer({request:async () => response,maxRequests:1});
  expect(result.status).toBe("retry_scheduled");
  const state = (await query("select streams from callyzer_sync_state")).rows[0].streams;
  expect(state.phone?.backfilled ?? false).toBe(false);
  expect((await query("select count(*)::int n from callyzer_calls")).rows[0].n).toBe(0);
});

it("does not grant sign-in access as a side effect of editing a missing caller link",async () => {
  await expect(upsertUser({email:"missing@callyzer.test",callyzer_number:number,callyzer_since:start})).rejects.toMatchObject({status:404});
  expect((await query("select count(*)::int n from bolna_app_users where email='missing@callyzer.test'")).rows[0].n).toBe(0);
});

it("rechecks the lease after waiting for a provider rate slot",async () => {
  let clock = Date.now();
  const request = vi.fn<CallyzerRequest>(async (_path,body) => ({result:[],page_no:Number(body.page_no),page_size:99,total_records:0}));
  const result = await syncCallyzer({request,now:() => clock,sleep:async ms => {
    clock += ms;
    await query("update callyzer_sync_state set lease_until=now()-interval '1 second'");
  }});
  expect(result.status).toBe("lease_lost");
  expect(request).toHaveBeenCalledTimes(1);
});

it("rejects a page-size change instead of silently skipping records",async () => {
  const result = await runner(async (_path,body) => {
    if (body.call_method !== "PhoneCall") return {result:[],page_size:2,total_records:0};
    if (Number(body.page_no) === 1) return {result:[call("0"),call("1")],page_size:2,total_records:6};
    if (Number(body.page_no) === 2) return {result:[call("3"),call("4"),call("5")],page_size:3,total_records:6};
    return {result:[],page_size:3,total_records:6};
  });
  expect(result.status).toBe("retry_scheduled");
  expect((await query("select source_id from callyzer_calls order by source_id")).rows.map(r => r.source_id)).toEqual(["0","1"]);
});

it.each([{logging:false,uninstalled:true},{logging:"No",uninstalled:"Yes"}])("records disabled device logging (%j) and still honors account-wide metadata rate limits",async ({logging,uninstalled}) => {
  await link();
  const result = await runner(async (path,body) => path === "employee/get" ?
    {result:[{emp_country_code:"91",emp_number:"9876543210",last_sync_req_at:"27 Oct 2026, 05:14 PM",app_settings:{is_log_active:logging},device_preference:{is_app_uninstalled:uninstalled}}]} :
    {result:[],page_no:Number(body.page_no),page_size:99,total_records:0});
  expect(result.status).toBe("current");
  expect((await query("select callyzer_device from bolna_app_users where email=$1",[caller])).rows[0].callyzer_device).toMatchObject({found:true,logging_enabled:false,app_uninstalled:true,last_sync_req_at:"2026-10-27T11:44:00.000Z"});
  await query("update bolna_app_users set callyzer_device=null where email=$1",[caller]);
  await query("update callyzer_sync_state set next_request_at=null");
  expect(await runner(async (path,body) => {
    if (path === "employee/get") throw new CallyzerError("Callyzer HTTP 429",600000,429);
    return {result:[],page_no:Number(body.page_no),page_size:99,total_records:0};
  })).toMatchObject({status:"retry_scheduled"});
  expect((await query("select next_attempt_at > now()+interval '9 minutes' delayed,last_success_at is not null retained from callyzer_sync_state")).rows[0]).toEqual({delayed:true,retained:true});
});

it("yields without a new HTTP request or backoff when a wait exhausts the time budget",async () => {
  let clock = Date.now();
  const request = vi.fn<CallyzerRequest>(async (_path,body) => ({result:[],page_no:Number(body.page_no),page_size:99,total_records:0}));
  expect(await syncCallyzer({request,now:() => clock,sleep:async () => {clock += 40000;}})).toMatchObject({status:"in_progress"});
  expect(request).toHaveBeenCalledTimes(1);
  expect((await query("select last_error,next_attempt_at,lease_token from callyzer_sync_state")).rows[0]).toEqual({last_error:null,next_attempt_at:null,lease_token:null});
});

it("preserves provider spacing when the database delays an HTTP start",async () => {
  let clock = Date.now(), delayed = false;
  const starts: number[] = [], realQuery = database.query;
  const spy = vi.spyOn(database,"query").mockImplementation(async (...args) => {
    const result = await realQuery(...args);
    if (!delayed && args[0].includes("interval '12 seconds'")) {clock += 10000;delayed = true;}
    return result;
  });
  try {
    await syncCallyzer({now:() => clock,sleep:async ms => {clock += ms;},request:async (_path,body) => {
      starts.push(clock);
      return {result:[],page_no:Number(body.page_no),page_size:99,total_records:0};
    }});
    expect(starts.length).toBeGreaterThan(1);
    expect(starts.slice(1).every((at,index) => at-starts[index]>=2000)).toBe(true);
  } finally {spy.mockRestore();}
});

it("preserves the shared cooldown when sequential workers have different clocks",async () => {
  let elapsed = 0;
  const origin = Date.now(), starts: number[] = [];
  const request: CallyzerRequest = async (_path,body) => {
    starts.push(elapsed);
    return {result:[],page_no:Number(body.page_no),page_size:99,total_records:0};
  };
  const sleep = async (ms: number) => {elapsed += ms;};
  await syncCallyzer({request,sleep,now:() => origin+elapsed-10000,maxRequests:1});
  await syncCallyzer({request,sleep,now:() => origin+elapsed+10000,maxRequests:1});
  expect(starts).toHaveLength(2);
  // Callyzer requires two seconds, irrespective of the app instances' clocks.
  expect(starts[1]-starts[0]).toBeGreaterThanOrEqual(2000);
});

it("does not persist future coverage or device checks when an app clock is fast",async () => {
  await link();
  let clock = Date.now()+2*3600000;
  const result = await syncCallyzer({now:() => clock,sleep:async ms => {clock += ms;},request:async (path,body) =>
    path === "employee/get" ? {result:[{emp_country_code:"91",emp_number:"9876543210"}]} :
    {result:[],page_no:Number(body.page_no),page_size:99,total_records:0}});
  expect(result.status).toBe("current");
  const observed = (await query(`select
    exists(select 1 from callyzer_sync_state,jsonb_each(streams) s
      where (s.value->>'through')::double precision>extract(epoch from clock_timestamp())) future_coverage,
    (callyzer_device->>'checked_at')::timestamptz>clock_timestamp() future_device
    from bolna_app_users where email=$1`,[caller])).rows[0];
  expect(observed).toEqual({future_coverage:false,future_device:false});
});

it("keeps channel turns fair after the next worker's app clock moves backwards",async () => {
  let clock = Date.now()+2*3600000;
  const seen: string[] = [];
  const request: CallyzerRequest = async (_path,body) => {
    const channel = `${body.call_method}:${body.call_mode}`;
    seen.push(channel);
    return {result:[call(`${channel}:${body.page_no}`)],page_no:Number(body.page_no),page_size:1,total_records:100};
  };
  const sleep = async (ms: number) => {clock += ms;};
  expect(await syncCallyzer({request,sleep,now:() => clock,maxRequests:2})).toMatchObject({pages:2});
  seen.length = 0;
  clock = Date.now();
  expect(await syncCallyzer({request,sleep,now:() => clock,maxRequests:3})).toMatchObject({pages:3});
  expect(new Set(seen)).toEqual(new Set(["PhoneCall:Voice","WhatsAppCall:Voice","WhatsAppCall:Video"]));
});

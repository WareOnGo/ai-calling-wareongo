import { beforeAll, beforeEach, afterAll, afterEach, describe, it, expect, vi } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { query, getPool } from "@/lib/db";
import { assignEntities, updateAssignment } from "@/lib/assignments";
import { getCalls, callsExportQuery, type CallRow } from "@/lib/calls";
import { getRawRecordsByIds, rawExportQuery } from "@/lib/raw";
import { csvResponse } from "@/lib/export";
import { claimEvent, storeEvent, runEvents } from "@/lib/process-events";
import { claimCallJob, runCallJob } from "@/lib/call-jobs";
import { dispatchBatch, dispatchSchema } from "@/lib/dispatch-service";
import { resolveBatch, reconcileBatch } from "@/lib/batch-reconciliation";
import { upsertUser } from "@/lib/users";
import { POST as webhook } from "@/app/api/bolna-webhook/route";
import { PATCH as patchAssignment } from "@/app/api/assignments/[id]/route";
import { PATCH as patchCall } from "@/app/api/calls/[id]/route";

const auth = vi.hoisted(() => ({ user: { email: "a@test.example", isAdmin: false, name: null } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => auth.user, getCurrentAdmin: async () => auth.user.isAdmin ? auth.user : null }));
const ai = vi.hoisted(() => ({ infer: vi.fn() }));
vi.mock("@/lib/openai", () => ({ INFERENCE_VERSION: 3, MODEL: "test-model", inferCall: ai.infer,
  inferDistrict: async () => ({ district: "Delhi", confidence: "High" }) }));
const admin = { email: "admin@test.example", name: null, isAdmin: true };
const a = { email: "a@test.example", name: null, isAdmin: false };
const b = { email: "b@test.example", name: null, isAdmin: false };
const verdict = { availability: "Available", built_up_area_sqft: "1000", carpet_area_sqft: "", city_area: "Delhi", expected_rent: "1000", possession: "Ready", confidence: "High", notes: "Available now" };
let callId: string, recordId: string;

beforeAll(async () => {
  const target = process.env.TEST_DATABASE_URL;
  if (!target || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(target).hostname)) throw new Error("TEST_DATABASE_URL must explicitly target a disposable local database");
  await query("select revision from bolna_call_logs limit 1");
});
beforeEach(async () => {
  // These tests deliberately reset only the app-owned fixture tables.
  await query("truncate bolna_assignments, bolna_app_users, bolna_webhook_events, bolna_call_logs, raw_phones, raw_records, raw_phone_numbers, call_batch_items, call_batches, bolna_dispatch_requests restart identity cascade");
  await query(`insert into bolna_app_users(email, role) values ($1,'admin'),($2,'employee'),($3,'employee')`, [admin.email, a.email, b.email]);
  callId = randomUUID(); recordId = randomUUID();
  const phone = (await query(`insert into raw_phone_numbers(phone_last10, phone) values ('9876543210', '+919876543210') returning phone_id`)).rows[0].phone_id;
  await query(`insert into raw_records(id, source, source_record_id, owner_name, city, state) values ($1,'fixture','1','=HYPERLINK(1)','Delhi','Delhi')`, [recordId]);
  await query("insert into raw_phones(master_id, phone_id, is_primary) values ($1,$2,true)", [recordId, phone]);
  await query(`insert into bolna_call_logs(id, status, transcript, total_cost, to_number, phone_id)
    values ($1,'completed','Owner says available in Delhi',1,'+919876543210',$2)`, [callId, phone]);
  auth.user = { ...a };
  ai.infer.mockReset().mockResolvedValue(verdict);
  // Every accidental external HTTP call fails the test; individual tests override this.
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unexpected external request"); }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
afterAll(async () => { await getPool().end(); });

describe("assignment isolation and writes", () => {
  it("shows A's completed assignment and B's open assignment only to their respective owners", async () => {
    for (const [entity, id] of [["call", callId], ["record", recordId]]) {
      await query(`insert into bolna_assignments(entity_type, entity_id, assignee, assigned_by, state, remarks, note)
        values ($1,$2,$3,$5,'done','A private','A brief'),($1,$2,$4,$5,'open','B private','B brief')`, [entity, id, a.email, b.email, admin.email]);
    }
    const rows = (await getCalls(a, {})).rows;
    expect(rows[0].assignment_remarks).toBe("A private");
    expect(rows[0].assigned_to).toBe(a.email);
    expect((await getCalls(b, {})).rows[0].assignment_remarks).toBe("B private");
    expect((await getRawRecordsByIds(a, [recordId]))[0].assignment_note).toBe("A brief");
    const spec = callsExportQuery(a, {});
    expect(await (await csvResponse(spec, [{ label: "Remarks", get: (row: { assignment_remarks: string }) => row.assignment_remarks }], "test.csv")).text()).not.toContain("B private");
    const raw = rawExportQuery(a, {}, [recordId]);
    expect(await (await csvResponse(raw, [{ label: "Note", get: (row: { assignment_note: string }) => row.assignment_note }], "raw.csv")).text()).not.toContain("B brief");
  });
  it("prevents employee unassignment and rejects stale edits", async () => {
    await assignEntities({ entity: "call", ids: [callId], assignee: a.email, assignedBy: admin.email });
    const id = (await query("select id from bolna_assignments")).rows[0].id;
    const request = (body: unknown) => new NextRequest("http://localhost", { method: "PATCH", body: JSON.stringify(body) });
    expect((await patchAssignment(request({ state: "dropped", revision: 0 }), { params: Promise.resolve({ id }) })).status).toBe(403);
    expect((await patchAssignment(request({ added_to_db: "false", revision: 0 }), { params: Promise.resolve({ id }) })).status).toBe(400);
    expect((await patchAssignment(request(null), { params: Promise.resolve({ id }) })).status).toBe(400);
    expect((await patchAssignment(request({ remarks: "saved", revision: 0 }), { params: Promise.resolve({ id }) })).status).toBe(200);
    expect((await patchAssignment(request({ remarks: "stale", revision: 0 }), { params: Promise.resolve({ id }) })).status).toBe(409);
    expect((await query("select remarks from bolna_assignments")).rows[0].remarks).toBe("saved");
  });
  it("rolls back reassignment when the target is invalid and rejects missing entities", async () => {
    await assignEntities({ entity: "record", ids: [recordId], assignee: a.email, assignedBy: admin.email });
    await expect(assignEntities({ entity: "record", ids: [recordId], assignee: "missing@test.example", assignedBy: admin.email, reassign: true })).rejects.toThrow();
    expect((await query("select state from bolna_assignments")).rows[0].state).toBe("open");
    await expect(assignEntities({ entity: "call", ids: [randomUUID()], assignee: a.email, assignedBy: admin.email })).rejects.toThrow();
  });
  it("serializes competing owners and refuses reopening when another owner is open", async () => {
    await Promise.all([a, b].map(owner => assignEntities({ entity: "call", ids: [callId], assignee: owner.email, assignedBy: admin.email })));
    expect((await query("select count(*) n from bolna_assignments where state = 'open'")).rows[0].n).toBe("1");
    await query("update bolna_assignments set state = 'done'");
    const previous = (await query("select id from bolna_assignments")).rows[0].id;
    await assignEntities({ entity: "call", ids: [callId], assignee: b.email, assignedBy: admin.email });
    await expect(updateAssignment(previous, admin, { state: "open", revision: 0 })).rejects.toMatchObject({ code: "23505" });
  });
  it("restores the old owner when insertion fails after reassignment starts", async () => {
    await assignEntities({ entity: "call", ids: [callId], assignee: a.email, assignedBy: admin.email });
    await query(`create function audit_reject_assignment() returns trigger language plpgsql as $$ begin raise exception 'injected insert failure'; end $$;
      create trigger audit_reject_assignment before insert on bolna_assignments for each row execute function audit_reject_assignment()`);
    try {
      await expect(assignEntities({ entity: "call", ids: [callId], assignee: b.email, assignedBy: admin.email, reassign: true })).rejects.toThrow("injected insert failure");
      expect((await query("select assignee, state from bolna_assignments")).rows).toEqual([{ assignee: a.email, state: "open" }]);
    } finally { await query("drop function audit_reject_assignment() cascade"); }
  });
  it("allows only an open owner to edit shared call fields", async () => {
    await query(`insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state) values ('call',$1,$2,$3,'done')`, [callId, a.email, admin.email]);
    const response = await patchCall(new NextRequest("http://localhost", { method: "PATCH", body: JSON.stringify({ called_by: "old owner", revision: 0 }) }), { params: Promise.resolve({ id: callId }) });
    expect(response.status).toBe(409);
    expect((await query("select called_by from bolna_call_logs where id = $1", [callId])).rows[0].called_by).toBeNull();
  });
  it("keeps an active administrator during concurrent removals", async () => {
    await upsertUser({ email: b.email, role: "admin" });
    const results = await Promise.allSettled([admin, b].map(user => upsertUser({ email: user.email, active: false })));
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    expect((await query("select count(*) n from bolna_app_users where active and role = 'admin'")).rows[0].n).toBe("1");
  });
});

describe("recoverable event processing and inference", () => {
  async function event(id = randomUUID()) {
    await query("insert into bolna_webhook_events(id, raw) values ($1,$2)", [id, { id, status: "completed", transcript: "Warehouse available", total_cost: 1, telephony_data: { to_number: "+919876543210" } }]);
    return id;
  }
  it("reclaims an expired lease and fences the original worker", async () => {
    await event();
    const first = (await claimEvent())!;
    expect(await claimEvent()).toBeUndefined();
    await query("update bolna_webhook_events set lease_until = now() - interval '1 second'");
    const second = (await claimEvent())!;
    expect(second.lease_token).not.toBe(first.lease_token);
    expect(second.attempts).toBe(2);
    expect(await storeEvent(first)).toBe(false);
    expect(await storeEvent(second)).toBe(true);
    expect(ai.infer).not.toHaveBeenCalled();
  });
  it("continues past a malformed event and enforces the retry budget", async () => {
    await query("insert into bolna_webhook_events(id,raw,max_attempts) values ($1,'{}',1)", [randomUUID()]);
    await event();
    const result = await runEvents();
    expect(result.succeeded).toBe(1); expect(result.failed).toBe(1);
    await query("update bolna_webhook_events set next_attempt_at = now()");
    expect(await claimEvent()).toBeUndefined();
  });
  it("continues when recording a failed event also fails", async () => {
    await query("insert into bolna_webhook_events(id,raw) values ($1,'{}')", [randomUUID()]);
    await event();
    await query(`create function audit_reject_failure() returns trigger language plpgsql as $$
      begin if new.status = 'failed' then raise exception 'injected failure update'; end if; return new; end $$;
      create trigger audit_reject_failure before update on bolna_webhook_events for each row execute function audit_reject_failure()`);
    try {
      const result = await runEvents();
      expect(result.succeeded).toBe(1); expect(result.failed).toBe(1);
      expect((await query("select count(*) n from bolna_webhook_events where status = 'processing' and lease_until is not null")).rows[0].n).toBe("1");
    } finally { await query("drop function audit_reject_failure() cascade"); }
  });
  it("accepts a later provider retry and ignores duplicate or out-of-order attempts", async () => {
    const id = randomUUID();
    for (const retry of [0, 2, 1, 2]) {
      expect((await webhook(new NextRequest("http://localhost/api/bolna-webhook", { method: "POST", headers: { "x-webhook-secret": "integration-webhook-secret" }, body: JSON.stringify({ id, status: "completed", retry_count: retry }) }))).status).toBe(200);
    }
    expect((await query("select retry_count from bolna_webhook_events where id = $1", [id])).rows[0].retry_count).toBe(2);
  });
  it("claims inference once and rejects output generated from a stale transcript", async () => {
    const jobs = await Promise.all([claimCallJob("inference", callId), claimCallJob("inference", callId)]);
    expect(jobs.filter(Boolean)).toHaveLength(1);
    const job = jobs.find(Boolean)!;
    await query("update bolna_call_logs set transcript = 'Different property' where id = $1", [callId]);
    expect((await runCallJob(job)).ok).toBe(false);
    expect((await query("select enriched from bolna_call_logs where id = $1", [callId])).rows[0].enriched).toBe(false);
    const fresh = (await claimCallJob("inference", callId))!;
    expect(fresh.input_hash).not.toBe(job.input_hash);
    expect((await runCallJob(fresh)).ok).toBe(true);
  });
  it("backs off failures and does not overwrite a newer inference version", async () => {
    ai.infer.mockRejectedValueOnce(new Error("provider unavailable"));
    const job = (await claimCallJob("inference", callId))!;
    await expect(runCallJob(job)).rejects.toThrow();
    expect(await claimCallJob("inference", callId)).toBeUndefined();
    await query("update bolna_call_jobs set available_at = now()");
    expect(await claimCallJob("inference", callId)).toBeDefined();
    await query("update bolna_call_logs set enriched = true, inference_version = 4 where id = $1", [callId]);
    expect(await claimCallJob("inference", callId, true)).toBeUndefined();
    await query("update bolna_call_logs set transcript = 'changed input', enriched = false, inference_version = 0 where id = $1", [callId]);
    await query("update bolna_call_jobs set version = 4 where call_id = $1", [callId]);
    expect(await claimCallJob("inference", callId)).toBeUndefined();
  });
  it("fences a running older model when a newer result arrives", async () => {
    const job = (await claimCallJob("inference", callId))!;
    await query("update bolna_call_logs set enriched = true, inference_version = 4, notes = 'new model result' where id = $1", [callId]);
    expect((await runCallJob(job)).ok).toBe(false);
    expect((await query("select notes from bolna_call_logs where id = $1", [callId])).rows[0].notes).toBe("new model result");
  });
});

describe("dispatch consistency", () => {
  const input = () => ({ ids: [recordId], intentKey: randomUUID(), confirm: true as const, routingMode: "auto" as const, excludeCats: [] });
  function provider() {
    return vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify(String(url).endsWith("/schedule") ? { ok: true } : { batch_id: "provider-batch" }), { status: 200 }));
  }
  it("only dispatches once when two requests race for the same number", async () => {
    const fetch = provider(); vi.stubGlobal("fetch", fetch);
    const results = await Promise.allSettled([dispatchBatch(admin, input()), dispatchBatch(admin, input())]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((await query("select count(*) n from bolna_dispatch_reservations")).rows[0].n).toBe("1");
  });
  it("replays an intent without recreating or rescheduling and rejects key reuse", async () => {
    const fetch = provider(); vi.stubGlobal("fetch", fetch);
    const request = input();
    const first = await dispatchBatch(admin, request);
    const second = await dispatchBatch(admin, request);
    expect(second.batchId).toBe(first.batchId);
    expect(fetch).toHaveBeenCalledTimes(2);
    await expect(dispatchBatch(admin, { ...request, ids: [randomUUID()] })).rejects.toMatchObject({ status: 409 });
  });
  it("keeps a lost create response reserved without trying another create", async () => {
    const fetch = vi.fn(async () => { throw new Error("create response lost"); }); vi.stubGlobal("fetch", fetch);
    const request = input();
    expect((await dispatchBatch(admin, request)).state).toBe("uncertain");
    expect((await dispatchBatch(admin, request)).state).toBe("uncertain");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await query("select count(*) n from bolna_dispatch_reservations")).rows[0].n).toBe("1");
  });
  it("persists the remote ID before scheduling and retains reservations on ambiguity", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/schedule")) {
        expect((await query("select bolna_batch_id from call_batches")).rows[0].bolna_batch_id).toBe("provider-batch");
        throw new Error("lost schedule response");
      }
      return new Response(JSON.stringify({ batch_id: "provider-batch" }));
    }));
    const result = await dispatchBatch(admin, input());
    expect(result.state).toBe("uncertain");
    expect((await query("select count(*) n from bolna_dispatch_reservations")).rows[0].n).toBe("1");
    await expect(dispatchBatch(admin, input())).rejects.toMatchObject({ status: 409 });
    await resolveBatch(result.batchId, "canceled", "Verified cancellation in provider", admin.email);
    expect((await query("select count(*) n from bolna_dispatch_reservations")).rows[0].n).toBe("0");
  });
  it("reconciles completed batches and releases reservations", async () => {
    vi.stubGlobal("fetch", provider());
    const sent = await dispatchBatch(admin, input());
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/executions")
      ? [{ status: "completed", telephony_data: { to_number: "+919876543210" } }]
      : { batch_id: "provider-batch", status: "executed", valid_contacts: 1 }))));
    expect((await reconcileBatch(sent.batchId)).state).toBe("completed");
    expect((await query("select count(*) n from bolna_dispatch_reservations")).rows[0].n).toBe("0");
  });
});

it("uses the same classification for un-enriched connected calls in both datasets", async () => {
  expect((await getCalls(admin, {})).rows[0].availability).toBe("Unclear");
  expect((await getRawRecordsByIds(admin, [recordId]))[0].last_availability).toBe("Unclear");
});

describe("geography dispatch", () => {
  async function englishRecord(phone = "8765432109") {
    const id = randomUUID();
    const phoneId = (await query("insert into raw_phone_numbers(phone_last10, phone) values ($1,$2) returning phone_id", [phone, `+91${phone}`])).rows[0].phone_id;
    await query("insert into raw_records(id, source, source_record_id, owner_name, city, state) values ($1,'fixture',$2,'English owner','Kochi','Kerala')", [id, id]);
    await query("insert into raw_phones(master_id, phone_id, is_primary) values ($1,$2,true)", [id, phoneId]);
    return id;
  }
  function request(ids: string[]) { return { ids, intentKey: randomUUID(), confirm: true as const, routingMode: "auto" as const, excludeCats: [] }; }
  function mixedProvider(failEnglishSchedule = false) {
    return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith("/schedule")) {
        if (failEnglishSchedule && path.includes("english")) throw new Error("English schedule response lost");
        return new Response(JSON.stringify({ ok: true }));
      }
      const form = init?.body as FormData;
      const language = form.get("agent_id") === process.env.BOLNA_ENGLISH_AGENT_ID ? "english" : "hindi";
      const csv = await (form.get("file") as Blob).text();
      expect(csv).toContain(language === "english" ? "+918765432109" : "+919876543210");
      expect(csv).not.toContain(language === "english" ? "+919876543210" : "+918765432109");
      expect((form.get("file") as File).name).toContain(`-${language}-`);
      return new Response(JSON.stringify({ batch_id: `provider-${language}` }));
    });
  }
  it("creates two correctly routed batches and replays the whole intent without more calls", async () => {
    const south = await englishRecord();
    const fetch = mixedProvider(); vi.stubGlobal("fetch", fetch);
    const input = request([recordId, south]);
    const result = await dispatchBatch(admin, input);
    expect(result.scheduled).toBe(true);
    expect(result.callable).toBe(2);
    expect(result.batches.map(batch => batch.language)).toEqual(["hindi", "english"]);
    expect(result.batches.map(batch => batch.agentId)).toEqual([process.env.BOLNA_AGENT_ID, process.env.BOLNA_ENGLISH_AGENT_ID]);
    expect((await query("select count(*) n from bolna_dispatch_reservations")).rows[0].n).toBe("2");
    const replay = await dispatchBatch(admin, input);
    expect(replay.batches).toEqual(result.batches);
    expect(fetch).toHaveBeenCalledTimes(4);
    await expect(dispatchBatch(admin, { ...input, routingMode: "english" })).rejects.toMatchObject({ status: 409 });
    // Changing deployment configuration cannot change an already accepted intent.
    vi.stubEnv("BOLNA_ENGLISH_AGENT_ID", randomUUID());
    expect((await dispatchBatch(admin, input)).batches).toEqual(result.batches);
    expect(fetch).toHaveBeenCalledTimes(4);
  });
  it("keeps requests from an older Hindi-only tab within its confirmed language scope", async () => {
    const south = await englishRecord();
    const fetch = mixedProvider(); vi.stubGlobal("fetch", fetch);
    const result = await dispatchBatch(admin, dispatchSchema.parse({ ids: [recordId, south], intentKey: randomUUID(), confirm: true }));
    expect(result.routingMode).toBe("hindi");
    expect(result.heldRegion).toBe(1);
    expect(result.batches.map(batch => batch.language)).toEqual(["hindi"]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("rechecks an older server's intent after waiting for its reservation transaction", async () => {
    const south = await englishRecord();
    const input = request([recordId, south]);
    const blocker = await getPool().connect();
    let sending: Promise<unknown> | undefined;
    try {
      await blocker.query("begin");
      await blocker.query("select pg_advisory_xact_lock(81620402)");
      sending = dispatchBatch(admin, input).then(result => result, error => error);
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        waiting = (await query("select 1 from pg_stat_activity where wait_event = 'advisory' and query = 'select pg_advisory_xact_lock(81620402)'")).rowCount! > 0;
        if (waiting) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      const hash = createHash("sha256").update(JSON.stringify({ ids: [...input.ids].sort(), exclusions: [] })).digest("hex");
      await blocker.query(`insert into call_batches(created_by,agent_id,scheduled_at,state,total,callable,intent_key,request_hash)
        values ($1,$2,now(),'scheduled',1,1,$3,$4)`, [admin.email, process.env.BOLNA_AGENT_ID, input.intentKey, hash]);
      await blocker.query("commit");
      expect(await sending).toMatchObject({ status: 409 });
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect((await query("select count(*) n from bolna_dispatch_requests")).rows[0].n).toBe("0");
    } finally { await blocker.query("rollback"); blocker.release(); await sending; }
  });
  it("does not duplicate either language when the same parent intent is submitted concurrently", async () => {
    const south = await englishRecord();
    const input = request([recordId, south]);
    const fetch = mixedProvider(); vi.stubGlobal("fetch", fetch);
    const results = await Promise.all([dispatchBatch(admin, input), dispatchBatch(admin, input)]);
    expect(results[0].batches.map(batch => batch.batchId)).toEqual(results[1].batches.map(batch => batch.batchId));
    expect(fetch).toHaveBeenCalledTimes(4);
    expect((await query("select count(*) n from bolna_dispatch_requests")).rows[0].n).toBe("1");
    expect((await query("select count(*) n from call_batches")).rows[0].n).toBe("2");
  });
  it("rejects the same provider UUID configured for both languages with different letter case", async () => {
    const id = "abcdefab-abcd-4abc-8abc-abcdefabcdef";
    vi.stubEnv("BOLNA_AGENT_ID", id.toUpperCase());
    vi.stubEnv("BOLNA_ENGLISH_AGENT_ID", id);
    await expect(dispatchBatch(admin, request([recordId]))).rejects.toMatchObject({ status: 503 });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect((await query("select count(*) n from call_batches")).rows[0].n).toBe("0");
  });
  it("tracks partial success without resending either language and releases only the resolved child", async () => {
    const south = await englishRecord();
    const fetch = mixedProvider(true); vi.stubGlobal("fetch", fetch);
    const input = request([recordId, south]);
    const result = await dispatchBatch(admin, input);
    expect(result.state).toBe("partial");
    expect(result.scheduled).toBe(false);
    expect(result.batches.map(batch => batch.state)).toEqual(["scheduled", "uncertain"]);
    expect(result.batches[1].bolnaBatchId).toBe("provider-english");
    expect((await dispatchBatch(admin, input)).batches).toEqual(result.batches);
    expect(fetch).toHaveBeenCalledTimes(4);
    await resolveBatch(result.batches[1].batchId, "canceled", "Verified English cancellation in provider", admin.email);
    expect((await query("select phone_last10 from bolna_dispatch_reservations")).rows).toEqual([{ phone_last10: "9876543210" }]);
    expect((await dispatchBatch(admin, input)).batches[1].state).toBe("canceled");
    expect(fetch).toHaveBeenCalledTimes(4);
  });
  it("reserves a number across competing Hindi and English requests", async () => {
    const fetch = vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify(String(url).endsWith("/schedule") ? { ok: true } : { batch_id: "provider-one" })));
    vi.stubGlobal("fetch", fetch);
    const results = await Promise.allSettled(["hindi", "english"].map(language => dispatchBatch(admin,
      { ...request([recordId]), routingMode: language as "hindi" | "english" })));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((await query("select count(*) n from call_batch_items")).rows[0].n).toBe("1");
  });
  it("holds English regions when English is unconfigured and rejects an explicit unavailable agent", async () => {
    const south = await englishRecord();
    vi.stubEnv("BOLNA_ENGLISH_AGENT_ID", "");
    const fetch = mixedProvider(); vi.stubGlobal("fetch", fetch);
    const result = await dispatchBatch(admin, request([recordId, south]));
    expect(result.heldRegion).toBe(1);
    expect(result.batches.map(batch => batch.language)).toEqual(["hindi"]);
    await expect(dispatchBatch(admin, { ...request([south]), routingMode: "english" })).rejects.toMatchObject({ status: 503 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("runs the approved English override without imposing the Hindi geography restriction", async () => {
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (!String(url).endsWith("/schedule")) expect((init?.body as FormData).get("agent_id")).toBe(process.env.BOLNA_ENGLISH_AGENT_ID);
      return new Response(JSON.stringify(String(url).endsWith("/schedule") ? { ok: true } : { batch_id: "provider-override" }));
    });
    vi.stubGlobal("fetch", fetch);
    const result = await dispatchBatch(admin, { ...request([recordId]), routingMode: "english" });
    expect(result.batches[0].language).toBe("english");
    expect(result.callable).toBe(1);
  });
});

it("persists carpet and built-up measurements separately through inference and call readers", async () => {
  ai.infer.mockResolvedValueOnce({ ...verdict, built_up_area_sqft: "1200", carpet_area_sqft: "900" });
  const job = (await claimCallJob("inference", callId))!;
  expect((await runCallJob(job)).ok).toBe(true);
  const row = (await getCalls(admin, {})).rows[0];
  expect(row.built_up_area_sqft).toBe("1200");
  expect(row.carpet_area_sqft).toBe("900");
  const spec = callsExportQuery(admin, {});
  const csv = await (await csvResponse(spec, [
    { label: "Built-up sqft", get: (row: CallRow) => row.built_up_area_sqft },
    { label: "Carpet sqft", get: (row: CallRow) => row.carpet_area_sqft },
  ], "areas.csv")).text();
  expect(csv).toContain("1200,900");
});

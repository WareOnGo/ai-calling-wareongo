import { beforeAll, beforeEach, afterEach, afterAll, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { getPool, query } from "@/lib/db";
import { POST as webhook } from "@/app/api/bolna-webhook/route";
import { claimEvent, storeEvent } from "@/lib/process-events";
import { recoverBatchHistory } from "@/lib/recover-batch-history";

const agent = "00000000-0000-0000-0000-000000000002";
let id: string, batch: string;
const payload = (extra: Record<string, unknown> = {}) => ({ id, agent_id: agent, batch_id: "provider-test", status: "completed", retry_count: 0,
  created_at: "2026-10-15T04:00:00Z", initiated_at: "2026-10-15T04:10:00Z", updated_at: "2026-10-15T04:11:00Z",
  conversation_duration: 49, transcript: "assistant: Hello\nuser: The warehouse is available", total_cost: 1,
  telephony_data: { provider_call_id: "dial-1", call_type: "outbound", to_number: "+919876543210", duration: 49, recording_url: "https://recording.test/one" }, ...extra });
const incomplete = () => payload({ status: "call-disconnected", updated_at: "2026-10-15T04:10:50Z", conversation_duration: 0,
  telephony_data: { ...payload().telephony_data, duration: 0, recording_url: null } });
const deliver = async (body: unknown) => webhook(new NextRequest("http://localhost/api/bolna-webhook", {
  method: "POST", headers: { "x-webhook-secret": "integration-webhook-secret" }, body: JSON.stringify(body),
}));
async function processOne() { const event = await claimEvent(); expect(event).toBeDefined(); return storeEvent(event!); }
function provider(pages: unknown[][] = [[payload()]], failPage = 0) {
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    expect(init?.method).toBe("GET");
    const url = new URL(String(input));
    if (url.pathname === "/batches/provider-test") return Response.json({ batch_id: "provider-test", status: "running" });
    expect(url.pathname).toBe("/v2/batches/provider-test/executions");
    expect(url.searchParams.get("page_size")).toBe("100");
    const page = Number(url.searchParams.get("page_number"));
    if (page === failPage) return new Response("failed", { status: 503 });
    return Response.json({ page_number: page, total: pages.flat().length, has_more: page < pages.length, data: pages[page - 1] });
  });
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
async function legacy() {
  const raw = incomplete();
  await query(`insert into bolna_call_logs(id,agent_id,batch_id,status,raw,to_number,call_type,duration_secs,transcript,
    added_to_db,wh_id,m_call_status,called_by) values($1,$2,'provider-test','call-disconnected',$3,'+919876543210','outbound',0,$4,true,'123','Available','caller@test.example')`,
  [id, agent, raw, raw.transcript]);
  await query("insert into bolna_webhook_events(id,raw,status,retry_count,processed_at) values($1,$2,'processed',0,now())", [id, raw]);
  await query("insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,remarks) values('call',$1,'caller@test.example','admin@test.example','Keep this manual note')", [id]);
}
beforeAll(() => {
  if (!process.env.TEST_DATABASE_URL || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(process.env.TEST_DATABASE_URL).hostname)) throw new Error("Disposable test database required");
});
beforeEach(async () => {
  await query("truncate bolna_ai_attempts,bolna_assignments,bolna_app_users,bolna_call_logs,bolna_webhook_events,raw_records,raw_phones,raw_phone_numbers,call_batches,bolna_dispatch_requests restart identity cascade");
  id = randomUUID(); batch = randomUUID();
  await query("insert into bolna_app_users(email,role) values('admin@test.example','admin'),('caller@test.example','employee')");
  await query("insert into call_batches(id,agent_id,bolna_batch_id,state,callable) values($1,$2,'provider-test','scheduled',1)", [batch, agent]);
  await query("insert into bolna_dispatch_reservations(phone_last10,batch_id) values('9876543210',$1)", [batch]);
  vi.stubEnv("ENFORCE_BOLNA_IP", "false"); vi.stubEnv("BOLNA_WEBHOOK_SECRET", "integration-webhook-secret");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request"); }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
afterAll(async () => { await getPool().end(); });

it("accepts completed details at the same retry number and records one real dial", async () => {
  expect((await deliver(incomplete())).status).toBe(200); await processOne();
  expect((await deliver(payload())).status).toBe(200); await processOne();
  expect((await query("select status,duration_secs,recording_url from bolna_call_logs where id=$1", [id])).rows[0])
    .toEqual({ status: "completed", duration_secs: 49, recording_url: "https://recording.test/one" });
  expect((await query("select count(*) n from bolna_ai_attempts")).rows[0].n).toBe("1");
  expect((await query("select confirmed_conversation from bolna_ai_attempts")).rows[0].confirmed_conversation).toBe(true);
});
it("fences a worker processing the earlier disconnected snapshot", async () => {
  await deliver(incomplete()); const stale = (await claimEvent())!;
  await deliver(payload()); expect(await storeEvent(stale)).toBe(false); await processOne();
  expect((await query("select status from bolna_call_logs")).rows[0].status).toBe("completed");
});
it("deduplicates concurrent deliveries and does not requeue processed or older payloads", async () => {
  expect((await Promise.all(Array.from({ length: 5 }, () => deliver(payload())))).every(r => r.status === 200)).toBe(true);
  await processOne(); await deliver(payload()); await deliver(incomplete());
  expect(await claimEvent()).toBeUndefined();
  expect((await query("select count(*) n from bolna_ai_attempts")).rows[0].n).toBe("1");
});
it("preserves each observed retry without inventing missing dials", async () => {
  await deliver(payload()); await processOne();
  const newer = payload({ retry_count: 8, initiated_at: "2026-10-15T05:10:00Z", updated_at: "2026-10-15T05:11:00Z",
    telephony_data: { ...payload().telephony_data, provider_call_id: "dial-2" } });
  await deliver(newer); await processOne(); await deliver(payload());
  expect(await claimEvent()).toBeUndefined();
  expect((await query("select count(*) n from bolna_ai_attempts")).rows[0].n).toBe("2");
  expect((await query("select raw->>'retry_count' retry from bolna_call_logs")).rows[0].retry).toBe("8");
});
it("retains phone and recording when a later completed update is sparse", async () => {
  await deliver(payload()); await processOne();
  await deliver({ id, status: "completed", updated_at: "2026-10-15T04:12:00Z", telephony_data: { provider_call_id: "dial-1", duration: 51 } });
  await processOne();
  expect((await query("select to_number,duration_secs,recording_url from bolna_call_logs")).rows[0])
    .toEqual({ to_number: "+919876543210", duration_secs: 51, recording_url: "https://recording.test/one" });
});
it("dry run leaves legacy data and evidence unchanged", async () => {
  await legacy(); provider();
  expect(await recoverBatchHistory(batch)).toMatchObject({ apply: false, retainedSnapshots: 2, providerExecutions: 1, wouldUpdate: 1, written: 0 });
  expect((await query("select count(*) n from bolna_ai_attempts")).rows[0].n).toBe("0");
  expect((await query("select status from bolna_call_logs")).rows[0].status).toBe("call-disconnected");
});
it("repairs legacy history idempotently while preserving manual work and reservations", async () => {
  await legacy(); provider();
  expect(await recoverBatchHistory(batch, { apply: true })).toMatchObject({ written: 1, deferred: 0 });
  await query("update bolna_call_logs set enriched=true,llm_availability='Available',inference_version=3");
  expect(await recoverBatchHistory(batch, { apply: true })).toMatchObject({ wouldUpdate: 0, written: 0 });
  expect((await query("select status,duration_secs,added_to_db,wh_id,m_call_status,called_by,enriched,llm_availability from bolna_call_logs")).rows[0])
    .toMatchObject({ status: "completed", duration_secs: 49, added_to_db: true, wh_id: "123", m_call_status: "Available", called_by: "caller@test.example", enriched: true, llm_availability: "Available" });
  expect((await query("select remarks,state from bolna_assignments")).rows[0]).toEqual({ remarks: "Keep this manual note", state: "open" });
  expect((await query("select state from call_batches")).rows[0].state).toBe("scheduled");
  expect((await query("select count(*) n from bolna_dispatch_reservations")).rows[0].n).toBe("1");
  expect((await query("select count(*) n from bolna_ai_attempts")).rows[0].n).toBe("1");
});
it("retains an older known dial before recovering a later provider retry", async () => {
  await legacy(); provider([[payload({ retry_count: 1, initiated_at: "2026-10-15T05:10:00Z", updated_at: "2026-10-15T05:11:00Z",
    telephony_data: { ...payload().telephony_data, provider_call_id: "dial-2" } })]]);
  await recoverBatchHistory(batch, { apply: true });
  expect((await query("select provider_call_id from bolna_ai_attempts order by provider_call_id")).rows).toEqual([{ provider_call_id: "dial-1" }, { provider_call_id: "dial-2" }]);
});
it("can resume after a provider page fails without duplicating calls or erasing inference", async () => {
  const second = payload({ id: randomUUID(), telephony_data: { ...payload().telephony_data, provider_call_id: "another-contact", to_number: "+919876543211" } });
  provider([[payload()], [second]], 2);
  await expect(recoverBatchHistory(batch, { apply: true })).rejects.toThrow("503");
  expect((await query("select count(*) n from bolna_call_logs")).rows[0].n).toBe("1");
  provider([[payload()], [second]]);
  expect(await recoverBatchHistory(batch, { apply: true })).toMatchObject({ pages: 2, written: 1 });
  expect((await query("select count(*) n from bolna_ai_attempts")).rows[0].n).toBe("2");
});
it("rejects provider pages from another batch", async () => {
  provider([[payload({ batch_id: "unrelated" })]]);
  await expect(recoverBatchHistory(batch, { apply: true })).rejects.toThrow("outside this batch");
  expect((await query("select count(*) n from bolna_call_logs")).rows[0].n).toBe("0");
});
it("does not turn scheduled or rescheduled executions into attempted calls", async () => {
  provider([[payload({ status: "scheduled" }), payload({ id: randomUUID(), status: "rescheduled" })]]);
  expect(await recoverBatchHistory(batch, { apply: true })).toMatchObject({ terminalExecutions: 0, written: 0 });
  expect((await query("select count(*) n from bolna_ai_attempts")).rows[0].n).toBe("0");
  expect((await query("select count(*) n from bolna_call_logs")).rows[0].n).toBe("0");
});
it("defers an unchanged event already leased by a worker", async () => {
  await deliver(payload()); const leased = (await claimEvent())!; provider();
  expect(await recoverBatchHistory(batch, { apply: true })).toMatchObject({ written: 0, deferred: 1 });
  expect(await storeEvent(leased)).toBe(true);
});
it("falls back to the legacy GET endpoint only when pagination is unsupported", async () => {
  const paths: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    expect(init?.method).toBe("GET"); const path = new URL(input).pathname; paths.push(path);
    if (path === "/batches/provider-test") return Response.json({ batch_id: "provider-test", status: "running" });
    if (path.startsWith("/v2/")) return new Response("Not found", { status: 404 });
    return Response.json([payload()]);
  }));
  expect(await recoverBatchHistory(batch, { apply: true })).toMatchObject({ written: 1, pages: 1 });
  expect(paths).toEqual(["/batches/provider-test", "/v2/batches/provider-test/executions", "/batches/provider-test/executions"]);
});
it.each([401, 403, 500])("does not hide provider error %s behind a fallback", async status => {
  const paths: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const path = new URL(input).pathname; paths.push(path);
    if (path === "/batches/provider-test") return Response.json({ batch_id: "provider-test", status: "running" });
    return new Response("Unavailable", { status });
  }));
  await expect(recoverBatchHistory(batch, { apply: true })).rejects.toThrow(String(status));
  expect(paths).not.toContain("/batches/provider-test/executions");
});

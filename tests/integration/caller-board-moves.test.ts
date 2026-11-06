import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { getPool, query } from "@/lib/db";
import { POST as move } from "@/app/api/board/move/route";
import { POST as followUp } from "@/app/api/board/follow-up/route";
import { PATCH as editNotes } from "@/app/api/board/tasks/[id]/route";
import { GET as timeline } from "@/app/api/board/timeline/route";
import { seedLegacyAssignments } from "./fixtures";

const caller = { email: "caller@moves.test", name: null, isAdmin: false };
const other = { email: "other@moves.test", name: null, isAdmin: false };
const admin = { email: "admin@moves.test", name: null, isAdmin: true };
const auth = vi.hoisted(() => ({ user: null as { email: string; name: null; isAdmin: boolean } | null }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => auth.user, getCurrentAdmin: async () => auth.user?.isAdmin ? auth.user : null }));

const post = (handler: (req: NextRequest) => Promise<Response>, url: string, body: unknown) =>
  handler(new NextRequest(`http://localhost${url}`, { method: "POST", body: JSON.stringify(body) }));
const moveCard = (body: unknown) => post(move, "/api/board/move", body);
const row = async (id: string) => (await query("select * from bolna_assignments where id=$1", [id])).rows[0];
const refs = async (...ids: string[]) => Promise.all(ids.map(async id => ({ id, revision: (await row(id)).revision })));
const attempts = async (id: string) => (await query("select disposition, actor from bolna_manual_attempts where assignment_id=$1", [id])).rows;

async function listing(phone: string) {
  const id = randomUUID();
  await query("insert into raw_phone_numbers(phone_last10,phone) values ($1,'+91'||$1) on conflict (phone_last10) do nothing", [phone]);
  await query("insert into raw_records(id,source,source_record_id,owner_name) values ($1::uuid,'moves',$1::text,'Owner')", [id]);
  await query("insert into raw_phones(master_id,phone_id,is_primary) select $1,phone_id,true from raw_phone_numbers where phone_last10=$2", [id, phone]);
  return id;
}
async function task(recordId: string, values: { assignee?: string; stage?: string; state?: string; outcome?: string | null; whId?: string | null } = {}) {
  return (await seedLegacyAssignments(`insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,stage,state,outcome,wh_id,completed_at)
    values ('record',$1,$2,$3,$4,$5,$6,$7,case when $5='done' then now() end) returning id::text`,
    [recordId, values.assignee ?? caller.email, admin.email, values.stage ?? "inbound", values.state ?? "open", values.outcome ?? null, values.whId ?? null])).rows[0].id as string;
}
async function warehouse(phone: string, ...ids: number[]) {
  await query("insert into bolna_warehouse_imports(name,snapshot_at,source_sha256,summary) values ('moves',now(),'fixture','{}') on conflict do nothing");
  for (const id of ids) await query("insert into bolna_warehouse_contacts values ($1,$2,array['contactNumber'],'moves')", [phone, id]);
}

beforeAll(() => {
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.TEST_DATABASE_URL!).hostname)) throw Error("Disposable local DB required");
});
beforeEach(async () => {
  await query("truncate bolna_warehouse_imports,bolna_assignments,bolna_app_users,bolna_call_logs,raw_records,raw_phones,raw_phone_numbers restart identity cascade");
  await query("insert into bolna_app_users(email,role) values ($1,'employee'),($2,'employee'),($3,'admin')", [caller.email, other.email, admin.email]);
  auth.user = { ...caller };
});
afterAll(async () => { await getPool().end(); });

describe("moving board cards", () => {
  it("moves every task on a card, records the implied result and returns the new revisions", async () => {
    const phone = "9811700001", first = await task(await listing(phone)), second = await task(await listing(phone));
    const response = await moveCard({ tasks: await refs(first, second), stage: "awaiting_details" });
    expect(response.status).toBe(200);
    expect((await response.json()).tasks).toEqual(expect.arrayContaining([
      { id: first, revision: 1, stage: "awaiting_details", state: "open" }, { id: second, revision: 1, stage: "awaiting_details", state: "open" }]));
    expect(await row(first)).toMatchObject({ stage: "awaiting_details", outcome: "Available", state: "open" });
    const audit = (await query("select actor, after_values->>'stage' stage from bolna_assignment_changes where assignment_id=$1 order by id desc limit 1", [first])).rows[0];
    expect(audit).toEqual({ actor: caller.email, stage: "awaiting_details" });
  });

  it("logs one no-answer call per task per day when a card enters RnR", async () => {
    const id = await task(await listing("9811700002"));
    expect((await moveCard({ tasks: await refs(id), stage: "rnr" })).status).toBe(200);
    expect(await attempts(id)).toEqual([{ disposition: "no_answer", actor: caller.email }]);
    expect(await row(id)).toMatchObject({ disposition: "no_answer", outcome: "Unclear" });
    expect((await row(id)).last_attempt_at).not.toBeNull();
    await moveCard({ tasks: await refs(id), stage: "inbound" });
    await moveCard({ tasks: await refs(id), stage: "rnr" });
    expect(await attempts(id)).toHaveLength(1);
  });

  it("finishes the card's tasks in Rejected, keeps the reason and clears the follow-up date", async () => {
    const id = await task(await listing("9811700003"));
    await query("update bolna_assignments set next_due_at=now()+interval '1 day' where id=$1", [id]);
    const response = await moveCard({ tasks: await refs(id), stage: "rejected", reason: "leased_out" });
    expect(response.status).toBe(200);
    const saved = await row(id);
    expect(saved).toMatchObject({ stage: "rejected", state: "done", outcome: "Unavailable", disposition: "leased_out", next_due_at: null });
    expect(saved.completed_at).not.toBeNull();
  });

  it("requires a junk reason and records the matching closure", async () => {
    const id = await task(await listing("9811700004"));
    const missing = await moveCard({ tasks: await refs(id), stage: "junk" });
    expect(missing.status).toBe(422);
    expect(await missing.json()).toMatchObject({ code: "REASON_REQUIRED", field: "reason" });
    expect((await moveCard({ tasks: await refs(id), stage: "junk", reason: "invalid_number" })).status).toBe(200);
    expect(await row(id)).toMatchObject({ stage: "junk", state: "done", disposition: "invalid_number", closure_reason: "invalid_number_verified" });
  });

  it("needs a warehouse ID for stage 4 unless the phone matches exactly one warehouse", async () => {
    const phone = "9811700005", id = await task(await listing(phone));
    const missing = await moveCard({ tasks: await refs(id), stage: "warehouse_created" });
    expect(missing.status).toBe(422);
    expect(await missing.json()).toMatchObject({ code: "WAREHOUSE_ID_REQUIRED", field: "wh_id" });
    expect((await moveCard({ tasks: await refs(id), stage: "warehouse_created", wh_id: "abc" })).status).toBe(422);
    await warehouse(phone, 4521);
    expect((await moveCard({ tasks: await refs(id), stage: "warehouse_created" })).status).toBe(200);
    expect(await row(id)).toMatchObject({ stage: "warehouse_created", state: "done", outcome: "Available", wh_id: "4521", added_to_db: true });
  });

  it("reopens finished work moved back to an open stage, unless another caller holds the phone", async () => {
    const phone = "9811700006", mine = await task(await listing(phone), { stage: "rejected", state: "done", outcome: "Unavailable" });
    expect((await moveCard({ tasks: await refs(mine), stage: "awaiting_details" })).status).toBe(200);
    expect(await row(mine)).toMatchObject({ state: "open", completed_at: null, closure_reason: null });
    await moveCard({ tasks: await refs(mine), stage: "rejected" });
    await task(await listing(phone), { assignee: other.email });
    const blocked = await moveCard({ tasks: await refs(mine), stage: "awaiting_details" });
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error).toMatch(/already has open work/);
    expect(await row(mine)).toMatchObject({ state: "done", stage: "rejected" });
  });

  it("will not reopen a number that already has a warehouse in the DB", async () => {
    const phone = "9811700007", id = await task(await listing(phone), { stage: "warehouse_created", state: "done", outcome: "Available", whId: "77" });
    await warehouse(phone, 77);
    const response = await moveCard({ tasks: await refs(id), stage: "details_collected" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "WAREHOUSE_ALREADY_ADDED" });
  });

  it("keeps a registered warehouse in stage 4: the card cannot go to Junk or Rejected either", async () => {
    const phone = "9811700017", id = await task(await listing(phone), { stage: "warehouse_created", state: "done", outcome: "Available", whId: "78" });
    await query("update bolna_assignments set added_to_db = true where id = $1", [id]);
    await warehouse(phone, 78);
    for (const move of [{ stage: "junk", reason: "invalid_number" }, { stage: "rejected" }]) {
      const response = await moveCard({ tasks: await refs(id), ...move });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "WAREHOUSE_ALREADY_ADDED" });
    }
    expect(await row(id)).toMatchObject({ stage: "warehouse_created", wh_id: "78", added_to_db: true });
  });

  it("clears an unregistered warehouse ID when the card leaves stage 4", async () => {
    const phone = "9811700018", id = await task(await listing(phone), { stage: "warehouse_created", state: "done", outcome: "Available", whId: "9876" });
    await query("update bolna_assignments set added_to_db = true where id = $1", [id]);
    expect((await moveCard({ tasks: await refs(id), stage: "details_collected" })).status).toBe(200);
    expect(await row(id)).toMatchObject({ stage: "details_collected", state: "open", wh_id: null, added_to_db: false });
  });

  it("changes nothing when any task on the card is stale", async () => {
    const phone = "9811700008", first = await task(await listing(phone)), second = await task(await listing(phone));
    const stale = [...await refs(first), { id: second, revision: 7 }];
    const response = await moveCard({ tasks: stale, stage: "details_collected" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "ASSIGNMENT_CONFLICT" });
    expect((await row(first)).stage).toBe("inbound");
  });

  it("only moves the signed-in person's own cards, for admins too, like My Work", async () => {
    const theirs = await task(await listing("9811700009"), { assignee: other.email });
    expect((await moveCard({ tasks: await refs(theirs), stage: "rejected" })).status).toBe(409);
    auth.user = { ...admin };
    expect((await moveCard({ tasks: await refs(theirs), stage: "rejected" })).status).toBe(409);
    expect((await row(theirs)).stage).toBe("inbound");
    const own = await task(await listing("9811700014"), { assignee: admin.email });
    expect((await moveCard({ tasks: await refs(own), stage: "rejected" })).status).toBe(200);
    expect((await query("select actor from bolna_assignment_changes where assignment_id=$1 order by id desc limit 1", [own])).rows[0].actor).toBe(admin.email);
  });

  it("keeps an admin's notes, follow-ups, calls and timeline to their own tasks", async () => {
    const theirs = await task(await listing("9811700015"), { assignee: other.email });
    auth.user = { ...admin };
    const notes = await editNotes(new NextRequest("http://localhost/api/board/tasks", { method: "PATCH", body: JSON.stringify({ revision: 0, remarks: "admin note" }) }), { params: Promise.resolve({ id: theirs }) });
    expect(notes.status).toBe(409);
    expect((await post(followUp, "/api/board/follow-up", { tasks: await refs(theirs), next_due_at: null })).status).toBe(409);
    expect((await (await timeline(new NextRequest(`http://localhost/api/board/timeline?task=${theirs}`))).json()).events).toEqual([]);
  });

  it("completes work without a logged call only through the board's workflow", async () => {
    const id = await task(await listing("9811700010"));
    await expect(query("update bolna_assignments set state='done',outcome='Unavailable',revision=revision+1 where id=$1", [id])).rejects.toThrow(/manual call/);
    expect((await moveCard({ tasks: await refs(id), stage: "rejected" })).status).toBe(200);
  });

  it("validates the request and requires a session", async () => {
    expect((await moveCard({ tasks: [], stage: "rnr" })).status).toBe(400);
    expect((await moveCard({ tasks: [{ id: "1", revision: 0 }], stage: "2A" })).status).toBe(400);
    auth.user = null;
    expect((await moveCard({ tasks: [{ id: "1", revision: 0 }], stage: "rnr" })).status).toBe(401);
  });
});

describe("editing a card", () => {
  it("saves a task's notes with a revision check", async () => {
    const id = await task(await listing("9811700011"));
    const patch = (body: unknown) => editNotes(new NextRequest("http://localhost/api/board/tasks", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
    const saved = await patch({ revision: 0, remarks: "Owner asked to call after Diwali" });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ id, revision: 1, remarks: "Owner asked to call after Diwali" });
    expect((await patch({ revision: 0, remarks: "stale" })).status).toBe(409);
    auth.user = { ...other };
    expect((await patch({ revision: 1, remarks: "not mine" })).status).toBe(409);
  });

  it("sets or clears the follow-up date on every open task of the card", async () => {
    const phone = "9811700012", first = await task(await listing(phone)), second = await task(await listing(phone));
    const due = new Date(Date.now() + 2 * 86400_000).toISOString();
    expect((await post(followUp, "/api/board/follow-up", { tasks: await refs(first, second), next_due_at: due })).status).toBe(200);
    expect(new Date((await row(second)).next_due_at).toISOString()).toBe(due);
    expect((await post(followUp, "/api/board/follow-up", { tasks: await refs(first, second), next_due_at: null })).status).toBe(200);
    expect((await row(first)).next_due_at).toBeNull();
    expect((await post(followUp, "/api/board/follow-up", { tasks: await refs(first), next_due_at: "tomorrow" })).status).toBe(400);
  });
});

describe("card timeline", () => {
  it("lists stage moves and note edits newest first, only for visible tasks, without calls for employees", async () => {
    const id = await task(await listing("9811700013"));
    await moveCard({ tasks: await refs(id), stage: "rnr" });
    await editNotes(new NextRequest("http://localhost/api/board/tasks", { method: "PATCH", body: JSON.stringify({ revision: (await row(id)).revision, remarks: "rang twice" }) }), { params: Promise.resolve({ id }) });
    const read = () => timeline(new NextRequest(`http://localhost/api/board/timeline?task=${id}`));
    // Employees do not see manual or Callyzer call records, so logged calls stay out.
    const events = (await (await read()).json()).events as { kind: string; text: string; actor: string | null }[];
    expect(events.map(event => event.kind)).toEqual(["notes", "stage"]);
    expect(events[0].text).toBe("rang twice");
    expect(events[1].text).toBe("Moved to 2A RnR");
    auth.user = { ...other };
    expect((await (await read()).json()).events).toEqual([]);
  });

  it("includes logged calls for admins on their own cards", async () => {
    auth.user = { ...admin };
    const id = await task(await listing("9811700016"), { assignee: admin.email });
    await moveCard({ tasks: await refs(id), stage: "rnr" });
    const events = (await (await timeline(new NextRequest(`http://localhost/api/board/timeline?task=${id}`))).json()).events as { kind: string; text: string }[];
    expect(events.map(event => [event.kind, event.text])).toEqual([["call", "No answer / RNR"], ["stage", "Moved to 2A RnR"]]);
  });
});

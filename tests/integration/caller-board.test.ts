import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { getPool, query } from "@/lib/db";
import { loadBoard, boardFilterOptions, type BoardCard } from "@/lib/board";
import { seedLegacyAssignments } from "./fixtures";

const caller = { email: "caller@board.test", isAdmin: false };
const other = { email: "other@board.test", isAdmin: false };
const admin = { email: "admin@board.test", isAdmin: true };

type Task = { assignee?: string; stage?: string; state?: string; remarks?: string | null; outcome?: string | null; nextDue?: string | null;
  updated?: string; batch?: string | null; whId?: string | null; added?: boolean; assignedBy?: string };

async function listing(phone: string, details: { owner?: string; city?: string; state?: string } = {}) {
  const id = randomUUID();
  await query("insert into raw_phone_numbers(phone_last10,phone) values ($1,'+91'||$1) on conflict (phone_last10) do nothing", [phone]);
  await query("insert into raw_records(id,source,source_record_id,owner_name,city,state) values ($1::uuid,'board',$1::text,$2,$3,$4)",
    [id, details.owner ?? `Owner ${phone.slice(-2)}`, details.city ?? null, details.state ?? null]);
  await query("insert into raw_phones(master_id,phone_id,is_primary) select $1,phone_id,true from raw_phone_numbers where phone_last10=$2", [id, phone]);
  return id;
}

async function task(recordId: string, t: Task = {}) {
  const result = await seedLegacyAssignments(`insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state,stage,remarks,outcome,next_due_at,updated_at,batch_id,wh_id,added_to_db,completed_at)
    values ('record',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,case when $4<>'open' then now() end) returning id::text`,
    [recordId, t.assignee ?? caller.email, t.assignedBy ?? admin.email, t.state ?? "open", t.stage ?? "inbound", t.remarks ?? null, t.outcome ?? null,
      t.nextDue ?? null, t.updated ?? new Date().toISOString(), t.batch ?? null, t.whId ?? null, t.added ?? false]);
  return result.rows[0].id as string;
}

async function batch(createdBy = admin.email) {
  return (await query(`insert into bolna_assignment_batches(intent_key,created_by,entity_type,distribution,assignees,selection,request_hash)
    values (gen_random_uuid(),$1,'record','single',array[$2],'{}'::jsonb,'fixture') returning id::text`, [createdBy, caller.email])).rows[0].id as string;
}

const column = (board: Awaited<ReturnType<typeof loadBoard>>, stage: string) => board.columns.find(c => c.stage === stage)!;
const names = (cards: BoardCard[]) => cards.map(card => card.name);
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString();

beforeAll(() => {
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.TEST_DATABASE_URL!).hostname)) throw Error("Disposable local DB required");
});
beforeEach(async () => {
  await query("truncate bolna_warehouse_imports,bolna_assignments,bolna_assignment_batches,bolna_app_users,bolna_call_logs,raw_records,raw_phones,raw_phone_numbers restart identity cascade");
  await query("insert into bolna_app_users(email,name,role) values ($1,'Caller One','employee'),($2,'Other Caller','employee'),($3,'Board Admin','admin')",
    [caller.email, other.email, admin.email]);
});
afterAll(async () => { await getPool().end(); });

describe("caller board read model", () => {
  it("groups a caller's open listings that share a phone into one card", async () => {
    await task(await listing("9811600001", { owner: "Gowda Estates", city: "Hoskote" }));
    await task(await listing("9811600001", { owner: "Gowda Estates", city: "Hoskote" }));
    await task(await listing("9811600002", { owner: "Venkat Storage" }));
    const inbound = column(await loadBoard(caller, {}), "inbound");
    expect(inbound.total).toBe(2);
    const gowda = inbound.cards.find(card => card.name === "Gowda Estates")!;
    expect(gowda.tasks).toHaveLength(2);
    expect(gowda).toMatchObject({ phone: "+919811600001", city: "Hoskote", assignee: caller.email, closed: false });
  });

  it("shows open work in every column but finished work only in 2B, 4 and 5, and never dropped work", async () => {
    await task(await listing("9811600011", { owner: "Open Details" }), { stage: "details_collected", outcome: "Available" });
    await task(await listing("9811600012", { owner: "Done Details" }), { stage: "details_collected", state: "done", outcome: "Available" });
    await task(await listing("9811600013", { owner: "Done Rejected" }), { stage: "rejected", state: "done", outcome: "Unavailable" });
    await task(await listing("9811600014", { owner: "Done Junk" }), { stage: "junk", state: "done" });
    await task(await listing("9811600015", { owner: "Dropped" }), { stage: "rnr", state: "dropped" });
    const board = await loadBoard(caller, {});
    expect(names(column(board, "details_collected").cards)).toEqual(["Open Details"]);
    expect(column(board, "rejected").cards[0]).toMatchObject({ name: "Done Rejected", closed: true });
    expect(names(column(board, "junk").cards)).toEqual(["Done Junk"]);
    expect(board.columns.flatMap(c => names(c.cards))).not.toContain("Dropped");
    expect(board.columns.map(c => c.stage)).toEqual(["inbound", "rnr", "rejected", "awaiting_details", "details_collected", "warehouse_created", "junk"]);
  });

  it("limits employees to their own work, even when they send an assignee filter", async () => {
    await task(await listing("9811600021", { owner: "Mine" }));
    await task(await listing("9811600022", { owner: "Theirs" }), { assignee: other.email });
    expect(names(column(await loadBoard(caller, {}), "inbound").cards)).toEqual(["Mine"]);
    expect(names(column(await loadBoard(caller, { assignee: [other.email] }), "inbound").cards)).toEqual(["Mine"]);
  });

  it("lets admins see every caller and narrow to chosen assignees", async () => {
    await task(await listing("9811600031", { owner: "Mine" }));
    await task(await listing("9811600032", { owner: "Theirs" }), { assignee: other.email });
    expect(names(column(await loadBoard(admin, {}), "inbound").cards).sort()).toEqual(["Mine", "Theirs"]);
    const narrowed = column(await loadBoard(admin, { assignee: [other.email] }), "inbound");
    expect(narrowed.cards).toEqual([expect.objectContaining({ name: "Theirs", assignee: other.email, assigneeName: "Other Caller" })]);
  });

  it("counts every matching card per column while returning only the requested number", async () => {
    for (let i = 0; i < 4; i++) await task(await listing(`98116000${40 + i}`, { owner: `Lead ${i}` }), { updated: hoursAgo(i) });
    const inbound = column(await loadBoard(caller, {}, { inbound: 2 }), "inbound");
    expect(inbound.total).toBe(4);
    expect(inbound.limit).toBe(2);
    expect(names(inbound.cards)).toEqual(["Lead 0", "Lead 1"]);
  });

  it("orders overdue follow-ups first, then the next follow-up date, then the latest update", async () => {
    await task(await listing("9811600051", { owner: "Recent" }), { stage: "rnr", updated: hoursAgo(1) });
    await task(await listing("9811600052", { owner: "Due later" }), { stage: "rnr", nextDue: hoursAgo(-48) });
    await task(await listing("9811600053", { owner: "Overdue" }), { stage: "rnr", nextDue: hoursAgo(5), updated: hoursAgo(30) });
    await task(await listing("9811600054", { owner: "Due sooner" }), { stage: "rnr", nextDue: hoursAgo(-2) });
    await task(await listing("9811600055", { owner: "Older" }), { stage: "rnr", updated: hoursAgo(10) });
    const rnr = column(await loadBoard(caller, {}), "rnr");
    expect(names(rnr.cards)).toEqual(["Overdue", "Due sooner", "Due later", "Recent", "Older"]);
    expect(rnr.cards[0].overdue).toBe(true);
    expect(rnr.cards[1].overdue).toBe(false);
  });

  it("filters by assignment batch, including work with no batch", async () => {
    const first = await batch();
    await task(await listing("9811600061", { owner: "In batch" }), { batch: first });
    await task(await listing("9811600062", { owner: "No batch" }));
    expect(names(column(await loadBoard(caller, { batch: [first] }), "inbound").cards)).toEqual(["In batch"]);
    expect(names(column(await loadBoard(caller, { batch: ["none"] }), "inbound").cards)).toEqual(["No batch"]);
    expect(column(await loadBoard(caller, { batch: [first, "none"] }), "inbound").total).toBe(2);
  });

  it("filters by city, state, assigner, last-updated window and search text", async () => {
    await task(await listing("9811600071", { owner: "Hoskote Yard", city: "Hoskote", state: "Karnataka" }), { remarks: "call after Diwali" });
    await task(await listing("9811600072", { owner: "Delhi Shed", city: "Delhi", state: "Delhi" }), { assignedBy: other.email, updated: hoursAgo(24 * 10) });
    const inbound = async (filters: Parameters<typeof loadBoard>[1]) => names(column(await loadBoard(caller, filters), "inbound").cards);
    expect(await inbound({ city: ["hoskote"] })).toEqual(["Hoskote Yard"]);
    expect(await inbound({ region: ["Delhi"] })).toEqual(["Delhi Shed"]);
    expect(await inbound({ assigned_by: [other.email] })).toEqual(["Delhi Shed"]);
    expect(await inbound({ updated: "7d" })).toEqual(["Hoskote Yard"]);
    expect(await inbound({ updated: "30d" })).toHaveLength(2);
    expect(await inbound({ q: "diwali" })).toEqual(["Hoskote Yard"]);
    expect(await inbound({ q: "600072" })).toEqual(["Delhi Shed"]);
    expect(await inbound({ q: "50%_" })).toEqual([]);
  });

  it("collects every warehouse ID matched to the card's phone or saved on its tasks", async () => {
    await task(await listing("9811600081", { owner: "Joshi Warehousing" }), { stage: "warehouse_created", state: "done", whId: "77", added: true, outcome: "Available" });
    await query("insert into bolna_warehouse_imports(name,snapshot_at,source_sha256,summary) values ('board-test',now(),'fixture','{}')");
    await query("insert into bolna_warehouse_contacts values ('9811600081',3120,array['contactNumber'],'board-test'),('9811600081',77,array['contactNumber'],'board-test')");
    const card = column(await loadBoard(caller, {}), "warehouse_created").cards[0];
    expect(card.warehouseIds).toEqual(["77", "3120"]);
  });

  it("offers filter choices only from work the viewer can see", async () => {
    const first = await batch();
    await task(await listing("9811600091", { city: "Hoskote", state: "Karnataka" }), { batch: first });
    await task(await listing("9811600092", { city: "Pune", state: "Maharashtra" }), { assignee: other.email });
    const mine = await boardFilterOptions(caller);
    expect(mine.cities).toEqual(["Hoskote"]);
    expect(mine.regions).toEqual(["Karnataka"]);
    expect(mine.batches).toEqual([expect.objectContaining({ id: first, tasks: 1 })]);
    expect(mine.assigners).toEqual([{ email: admin.email, name: "Board Admin" }]);
    expect(mine.assignees).toEqual([]);
    const all = await boardFilterOptions(admin);
    expect(all.cities).toEqual(["Hoskote", "Pune"]);
    expect(all.assignees.map(a => a.email)).toEqual([caller.email, other.email]);
  });
});

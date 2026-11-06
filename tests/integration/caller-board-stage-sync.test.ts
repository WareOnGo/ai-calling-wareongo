// Migration 021: work recorded outside the board (My Work, admin edits) keeps the
// task's board stage in step, using 019's inference, and the one-off catch-up
// re-places tasks the board never moved.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { getPool, query, transaction } from "@/lib/db";
import { assignEntities } from "@/lib/assignments";
import { loadBoard } from "@/lib/board";
import { loadFunnel } from "@/lib/board-funnel";
import { PATCH as myWorkPatch } from "@/app/api/my-work/assignments/[id]/route";
import { PATCH as adminPatch, DELETE as adminDrop } from "@/app/api/assignments/[id]/route";
import { POST as move } from "@/app/api/board/move/route";
import { PATCH as boardNotes } from "@/app/api/board/tasks/[id]/route";
import { seedLegacyAssignments } from "./fixtures";

const caller = { email: "caller@stage-sync.test", name: null, isAdmin: false };
const admin = { email: "admin@stage-sync.test", name: null, isAdmin: true };
const auth = vi.hoisted(() => ({ user: null as { email: string; name: null; isAdmin: boolean } | null }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => auth.user, getCurrentAdmin: async () => auth.user?.isAdmin ? auth.user : null }));

const row = async (id: string) => (await query("select * from bolna_assignments where id=$1", [id])).rows[0];
const json = (method: string, url: string, body: unknown) => new NextRequest(`http://localhost${url}`, { method, body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
async function myWork(id: string, body: Record<string, unknown>) {
  auth.user = { ...caller };
  const response = await myWorkPatch(json("PATCH", `/api/my-work/assignments/${id}`, { revision: (await row(id)).revision, ...body }), params(id));
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
}
async function adminEdit(id: string, body: Record<string, unknown>) {
  auth.user = { ...admin };
  const response = await adminPatch(json("PATCH", `/api/assignments/${id}`, { revision: (await row(id)).revision, ...body }), params(id));
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
}
async function boardMove(id: string, stage: string, extra: Record<string, unknown> = {}) {
  auth.user = { ...caller };
  const response = await move(json("POST", "/api/board/move", { tasks: [{ id, revision: (await row(id)).revision }], stage, ...extra }));
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
}
const latestAudit = async (id: string) => (await query(
  "select actor, before_values->>'stage' before_stage, after_values->>'stage' after_stage from bolna_assignment_changes where assignment_id=$1 order by id desc limit 1", [id])).rows[0];
const auditCount = async (id: string) => Number((await query("select count(*) from bolna_assignment_changes where assignment_id=$1", [id])).rows[0].count);

let phoneSeq = 0;
/** A fresh listing with its own phone, assigned to the caller as one open task. */
async function newTask(): Promise<string> {
  const recordId = randomUUID(), phone = `98117${String(++phoneSeq).padStart(5, "0")}`;
  await query("insert into raw_phone_numbers(phone_last10,phone) values ($1,'+91'||$1)", [phone]);
  await query("insert into raw_records(id,source,source_record_id,owner_name) values ($1::uuid,'stage-sync',$1::text,'Owner')", [recordId]);
  await query("insert into raw_phones(master_id,phone_id,is_primary) select $1,phone_id,true from raw_phone_numbers where phone_last10=$2", [recordId, phone]);
  await assignEntities({ entity: "record", ids: [recordId], assignee: caller.email, assignedBy: admin.email });
  return (await query("select id::text from bolna_assignments where entity_id=$1::uuid", [recordId])).rows[0].id;
}

beforeAll(() => {
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.TEST_DATABASE_URL!).hostname)) throw Error("Disposable local DB required");
});
beforeEach(async () => {
  await query("truncate bolna_warehouse_imports,bolna_assignments,bolna_assignment_batches,bolna_app_users,bolna_call_logs,raw_records,raw_phones,raw_phone_numbers restart identity cascade");
  await query("insert into bolna_app_users(email,role) values ($1,'employee'),($2,'admin')", [caller.email, admin.email]);
});
afterAll(async () => { await getPool().end(); });

describe("work recorded in My Work keeps the board stage in step", () => {
  it("puts a task finished in My Work with a warehouse ID in stage 4, on the board and in the funnel", async () => {
    const id = await newTask();
    await myWork(id, { outcome: "Available", wh_id: "4521", state: "done", remarks: "Listed" });
    expect(await row(id)).toMatchObject({ stage: "warehouse_created", state: "done", revision: 1 });
    // One audit row per save, attributed to the caller, carrying the stage with the result.
    expect(await latestAudit(id)).toEqual({ actor: caller.email, before_stage: "inbound", after_stage: "warehouse_created" });
    const board = await loadBoard(caller, {});
    expect(board.columns.find(column => column.stage === "warehouse_created")!.total).toBe(1);
    const funnel = await loadFunnel(admin, {});
    expect(funnel.totals).toMatchObject({ warehouseLeads: 1, warehouseIdCount: 1 });
  });

  it("places a task by the result chosen in My Work, reading notes as the backfill does", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ outcome: "Unclear" }, "rnr"],
      [{ outcome: "Unclear", remarks: "will call back tomorrow" }, "awaiting_details"],
      [{ outcome: "Unavailable", state: "done", remarks: "Leased out" }, "rejected"],
      [{ outcome: "Available" }, "awaiting_details"],
      [{ outcome: "Available", remarks: "20000 sq ft, rent 22 per sq ft" }, "details_collected"],
      [{ outcome: "Unavailable", remarks: "broker, not owner" }, "inbound"],
    ];
    for (const [patch, stage] of cases) {
      const id = await newTask();
      await myWork(id, patch);
      expect((await row(id)).stage, JSON.stringify(patch)).toBe(stage);
    }
  });

  it("reads notes on a task still in Inbound, so remarks-only work leaves Inbound", async () => {
    const id = await newTask();
    await myWork(id, { remarks: "not picking up" });
    expect((await row(id)).stage).toBe("rnr");
    const leased = await newTask();
    await myWork(leased, { remarks: "already leased out", state: "done" });
    expect(await row(leased)).toMatchObject({ stage: "rejected", state: "done" });
  });

  it("keeps the column a caller chose on the board when My Work edits only notes or completion", async () => {
    const id = await newTask();
    await boardMove(id, "details_collected");
    await myWork(id, { remarks: "spoke again, nothing new" });
    expect((await row(id)).stage).toBe("details_collected");
    await myWork(id, { state: "done" });
    expect(await row(id)).toMatchObject({ stage: "details_collected", state: "done" });
  });

  it("moves a card into and out of stage 4 when My Work adds or removes its warehouse", async () => {
    const id = await newTask();
    await boardMove(id, "awaiting_details");
    await myWork(id, { added_to_db: true });
    expect((await row(id)).stage).toBe("warehouse_created");
    await myWork(id, { added_to_db: false });
    expect((await row(id)).stage).toBe("awaiting_details");
    // Changing one valid warehouse ID for another keeps the card in stage 4.
    await myWork(id, { wh_id: "4521" });
    await myWork(id, { wh_id: "4522" });
    expect(await row(id)).toMatchObject({ stage: "warehouse_created", wh_id: "4522" });
  });

  it("applies the same rule to admin edits", async () => {
    const id = await newTask();
    await adminEdit(id, { outcome: "Unavailable", remarks: "Sold" });
    expect(await row(id)).toMatchObject({ stage: "rejected", state: "open" });
    expect((await latestAudit(id)).actor).toBe(admin.email);
  });

  it("leaves board writes, explicit stage writes and dropped tasks alone", async () => {
    // The board chooses its own stage: Junk keeps no result, and notes saved on the board do not move the card.
    const junk = await newTask();
    await boardMove(junk, "junk", { reason: "invalid_number" });
    expect(await row(junk)).toMatchObject({ stage: "junk", state: "done" });
    const noted = await newTask();
    auth.user = { ...caller };
    const saved = await boardNotes(json("PATCH", `/api/board/tasks/${noted}`, { revision: (await row(noted)).revision, remarks: "not picking up" }), params(noted));
    expect(saved.status).toBe(200);
    expect((await row(noted)).stage).toBe("inbound");
    // A writer that sets the stage itself keeps it.
    const explicit = await newTask();
    await query("update bolna_assignments set stage='rnr', outcome='Available', revision=revision+1 where id=$1", [explicit]);
    expect((await row(explicit)).stage).toBe("rnr");
    // Unassigning keeps the stage the task had.
    const dropped = await newTask();
    await myWork(dropped, { remarks: "not picking up" });
    auth.user = { ...admin };
    expect((await adminDrop(new NextRequest(`http://localhost/api/assignments/${dropped}`, { method: "DELETE" }), params(dropped))).status).toBe(200);
    expect(await row(dropped)).toMatchObject({ stage: "rnr", state: "dropped" });
  });

  it("works the same with the quality guard disabled, as on production", async () => {
    const id = await newTask();
    await query("alter table bolna_assignments disable trigger bolna_assignment_quality_guard");
    try {
      await myWork(id, { outcome: "Available", wh_id: "4521", state: "done" });
    } finally {
      await query("alter table bolna_assignments enable trigger bolna_assignment_quality_guard");
    }
    expect(await row(id)).toMatchObject({ stage: "warehouse_created", revision: 1 });
  });
});

/** The catch-up block of migration 021, run as the migration runs it. */
const catchUp = () => {
  const sql = readFileSync(new URL("../../database/migrations/021_caller_board_stage_sync.sql", import.meta.url), "utf8");
  const block = sql.match(/-- stage-resync:begin\n([\s\S]*?)-- stage-resync:end/);
  if (!block) throw Error("021 has no stage-resync block");
  return transaction(client => client.query(block[1]));
};

describe("021 catch-up", () => {
  it("re-places tasks the board never moved, keeping their last-change time, and leaves board placements alone", async () => {
    // Saved in My Work before 021: the result says stage 4, the stage still says Inbound.
    const stale = await newTask();
    await query("alter table bolna_assignments disable trigger bolna_assignment_stage_sync");
    try {
      await myWork(stale, { outcome: "Available", wh_id: "4521", state: "done" });
    } finally {
      await query("alter table bolna_assignments enable trigger bolna_assignment_stage_sync");
    }
    expect((await row(stale)).stage).toBe("inbound");
    const before = await row(stale);
    // Placed on the board; the notes-free inference would say 2C, but the caller chose 3.
    const placed = await newTask();
    await boardMove(placed, "details_collected");
    // Already consistent: nothing to write.
    const settled = await newTask();
    await myWork(settled, { outcome: "Unclear" });
    // Unassigned work is history.
    const dropped = await newTask();
    await seedLegacyAssignments("update bolna_assignments set state='dropped', outcome='Unavailable' where id=$1", [dropped]);
    const counts = { placed: await auditCount(placed), settled: await auditCount(settled), dropped: await auditCount(dropped) };

    await catchUp();

    expect(await row(stale)).toMatchObject({ stage: "warehouse_created", revision: before.revision });
    expect((await row(stale)).updated_at).toEqual(before.updated_at);
    expect(await latestAudit(stale)).toEqual({ actor: "stage-sync", before_stage: "inbound", after_stage: "warehouse_created" });
    expect((await row(placed)).stage).toBe("details_collected");
    expect((await row(dropped)).stage).toBe("inbound");
    expect({ placed: await auditCount(placed), settled: await auditCount(settled), dropped: await auditCount(dropped) }).toEqual(counts);
    // The touch trigger is back on afterwards.
    const touch = (await query("select tgenabled from pg_trigger where tgname='bolna_assignment_touch'")).rows[0];
    expect(touch.tgenabled).toBe("O");
  });
});

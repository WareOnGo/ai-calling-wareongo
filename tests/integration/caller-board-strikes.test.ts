import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { getPool, query } from "@/lib/db";
import { loadBoard, loadJunkProposals } from "@/lib/board";
import { POST as noAnswer } from "@/app/api/board/no-answer/route";
import { seedLegacyAssignments } from "./fixtures";

const caller = { email: "caller@strikes.test", name: null, isAdmin: false };
const other = { email: "other@strikes.test", name: null, isAdmin: false };
const admin = { email: "admin@strikes.test", name: null, isAdmin: true };
const auth = vi.hoisted(() => ({ user: null as { email: string; name: null; isAdmin: boolean } | null }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => auth.user, getCurrentAdmin: async () => auth.user?.isAdmin ? auth.user : null }));

async function task(phone: string, values: { assignee?: string; stage?: string; state?: string; nextDue?: string | null } = {}) {
  const record = randomUUID();
  await query("insert into raw_phone_numbers(phone_last10,phone) values ($1,'+91'||$1) on conflict (phone_last10) do nothing", [phone]);
  await query("insert into raw_records(id,source,source_record_id,owner_name) values ($1::uuid,'strikes',$1::text,$2)", [record, `Owner ${phone.slice(-3)}`]);
  await query("insert into raw_phones(master_id,phone_id,is_primary) select $1,phone_id,true from raw_phone_numbers where phone_last10=$2", [record, phone]);
  return (await seedLegacyAssignments(`insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,assigned_at,stage,state,next_due_at,completed_at)
    values ('record',$1,$2,$3,now()-interval '30 days',$4,$5,$6,case when $5='done' then now() end) returning id::text`,
    [record, values.assignee ?? caller.email, admin.email, values.stage ?? "rnr", values.state ?? "open", values.nextDue ?? null])).rows[0].id as string;
}
/** Logs an attempt `daysAgo` IST days back at noon IST. */
async function attempt(taskId: string, daysAgo: number, disposition = "no_answer") {
  await query(`insert into bolna_manual_attempts(id,assignment_id,actor,assignee,occurred_at,disposition,next_due_at,request_hash)
    select $1,id,assignee,assignee,((now() at time zone 'Asia/Kolkata')::date - $2::int + time '12:00') at time zone 'Asia/Kolkata',$3,
      case when $3 in ('callback','awaiting_confirmation') then now() end,'fixture'
    from bolna_assignments where id=$4`, [randomUUID(), daysAgo, disposition, taskId]);
}
const cardFor = async (viewer: typeof caller, name: string) =>
  (await loadBoard(viewer, {})).columns.flatMap(column => column.cards).find(card => card.name === name)!;
const logNoAnswer = (tasks: { id: string; revision: number }[]) =>
  noAnswer(new NextRequest("http://localhost/api/board/no-answer", { method: "POST", body: JSON.stringify({ tasks }) }));
const refs = async (...ids: string[]) => (await query<{ id: string; revision: number }>("select id::text, revision from bolna_assignments where id=any($1::bigint[]) order by id", [ids])).rows;

beforeAll(() => {
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.TEST_DATABASE_URL!).hostname)) throw Error("Disposable local DB required");
});
beforeEach(async () => {
  await query("truncate bolna_assignments,bolna_app_users,bolna_call_logs,raw_records,raw_phones,raw_phone_numbers restart identity cascade");
  await query("insert into bolna_app_users(email,role) values ($1,'employee'),($2,'employee'),($3,'admin')", [caller.email, other.email, admin.email]);
  auth.user = { ...caller };
});
afterAll(async () => { await getPool().end(); });

describe("strikes", () => {
  it("counts one strike per IST day with an unanswered call across the card's tasks", async () => {
    const first = await task("9811800001"), second = await task("9811800001");
    await attempt(first, 0); await attempt(second, 0);          // same day on two tasks: one strike
    await attempt(first, 1, "busy"); await attempt(second, 2, "switched_off");
    await attempt(first, 3, "connected"); await attempt(first, 4, "callback"); // answered calls are not strikes
    expect((await cardFor(caller, "Owner 001")).strikes).toBe(3);
  });

  it("proposes a card for Junk at five strikes, not before", async () => {
    const id = await task("9811800002");
    for (const day of [0, 1, 2, 3]) await attempt(id, day);
    expect(await cardFor(caller, "Owner 002")).toMatchObject({ strikes: 4, proposedJunk: false });
    await attempt(id, 4);
    expect(await cardFor(caller, "Owner 002")).toMatchObject({ strikes: 5, proposedJunk: true });
    expect(await loadJunkProposals(caller, {})).toMatchObject({ total: 1, cards: [expect.objectContaining({ name: "Owner 002", strikes: 5 })] });
  });

  it("does not propose cards the caller chose to keep trying, or finished cards", async () => {
    const keep = await task("9811800003", { nextDue: new Date(Date.now() + 86400_000).toISOString() });
    const overdue = await task("9811800004", { nextDue: new Date(Date.now() - 86400_000).toISOString() });
    const junk = await task("9811800005", { stage: "junk", state: "done" });
    for (const id of [keep, overdue, junk]) for (const day of [0, 1, 2, 3, 4]) await attempt(id, day);
    const proposals = await loadJunkProposals(caller, {});
    expect(proposals.cards.map(card => card.name)).toEqual(["Owner 004"]);
  });

  it("lists proposals within the viewer's scope and filters", async () => {
    const mine = await task("9811800006"), theirs = await task("9811800007", { assignee: other.email });
    for (const id of [mine, theirs]) for (const day of [0, 1, 2, 3, 4]) await attempt(id, day);
    expect((await loadJunkProposals(caller, {})).cards.map(card => card.name)).toEqual(["Owner 006"]);
    expect((await loadJunkProposals(admin, {})).total).toBe(2);
    expect((await loadJunkProposals(admin, { assignee: [other.email] })).cards.map(card => card.name)).toEqual(["Owner 007"]);
  });
});

describe("logging another no-answer from the board", () => {
  it("records one unanswered call per open task for today and counts it once", async () => {
    const first = await task("9811800008"), second = await task("9811800008");
    const response = await logNoAnswer(await refs(first, second));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ logged: 2 });
    expect((await cardFor(caller, "Owner 008")).strikes).toBe(1);
    expect((await query("select disposition, last_attempt_at is not null as attempted from bolna_assignments where id=$1", [first])).rows[0])
      .toEqual({ disposition: "no_answer", attempted: true });
    const again = await logNoAnswer(await refs(first, second));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ logged: 0 });
    expect((await query("select count(*)::int n from bolna_manual_attempts")).rows[0].n).toBe(2);
  });

  it("refuses finished, stale or other callers' work", async () => {
    const done = await task("9811800009", { stage: "rejected", state: "done" });
    expect((await logNoAnswer(await refs(done))).status).toBe(422);
    const open = await task("9811800010");
    expect((await logNoAnswer([{ id: open, revision: 9 }])).status).toBe(409);
    const theirs = await task("9811800011", { assignee: other.email });
    expect((await logNoAnswer(await refs(theirs))).status).toBe(409);
  });
});

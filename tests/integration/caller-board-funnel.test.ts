import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { getPool, query } from "@/lib/db";
import { loadFunnel } from "@/lib/board-funnel";
import { seedLegacyAssignments } from "./fixtures";

const admin = { email: "admin@funnel.test", isAdmin: true };
const ana = "ana@funnel.test", ben = "ben@funnel.test";

async function lead(phone: string, assignee: string, stage: string, values: { state?: string; whId?: string | null; city?: string; batch?: string | null } = {}) {
  const record = randomUUID();
  await query("insert into raw_phone_numbers(phone_last10,phone) values ($1,'+91'||$1) on conflict (phone_last10) do nothing", [phone]);
  await query("insert into raw_records(id,source,source_record_id,owner_name,city) values ($1::uuid,'funnel',$1::text,'Owner',$2)", [record, values.city ?? null]);
  await query("insert into raw_phones(master_id,phone_id,is_primary) select $1,phone_id,true from raw_phone_numbers where phone_last10=$2", [record, phone]);
  return (await seedLegacyAssignments(`insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,stage,state,wh_id,batch_id,completed_at)
    values ('record',$1,$2,$3,$4,$5,$6,$7,case when $5='done' then now() end) returning id::text`,
    [record, assignee, admin.email, stage, values.state ?? "open", values.whId ?? null, values.batch ?? null])).rows[0].id as string;
}
const row = (funnel: Awaited<ReturnType<typeof loadFunnel>>, email: string) => funnel.rows.find(r => r.assignee === email)!;

beforeAll(() => {
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.TEST_DATABASE_URL!).hostname)) throw Error("Disposable local DB required");
});
beforeEach(async () => {
  await query("truncate bolna_warehouse_imports,bolna_assignments,bolna_assignment_batches,bolna_app_users,raw_records,raw_phones,raw_phone_numbers restart identity cascade");
  await query("insert into bolna_app_users(email,name,role) values ($1,'Admin','admin'),($2,'Ana','employee'),($3,'Ben','employee')", [admin.email, ana, ben]);
});
afterAll(async () => { await getPool().end(); });

describe("funnel by caller", () => {
  it("counts each caller's leads by stage, including finished work in any stage, but never dropped work", async () => {
    await lead("9811900001", ana, "inbound");
    await lead("9811900001", ana, "inbound");                         // same phone: one lead
    await lead("9811900002", ana, "details_collected", { state: "done" }); // finished outside 2B/4/5 still counts
    await lead("9811900003", ana, "rejected", { state: "done" });
    await lead("9811900004", ana, "rnr", { state: "dropped" });
    await lead("9811900005", ben, "rnr");
    const funnel = await loadFunnel(admin, {});
    expect(row(funnel, ana)).toMatchObject({ name: "Ana", leads: 3, stages: { inbound: 1, details_collected: 1, rejected: 1, rnr: 0 } });
    expect(row(funnel, ben)).toMatchObject({ leads: 1, stages: { rnr: 1 } });
    expect(funnel.totals.leads).toBe(4);
  });

  it("credits warehouse IDs on stage 4 leads to their caller and counts each ID once in total", async () => {
    await lead("9811900011", ana, "warehouse_created", { state: "done", whId: "77" });
    await lead("9811900012", ben, "warehouse_created", { state: "done", whId: "88" });
    await lead("9811900013", ben, "details_collected", { whId: "99" });  // not stage 4: no credit yet
    await query("insert into bolna_warehouse_imports(name,snapshot_at,source_sha256,summary) values ('funnel',now(),'fixture','{}')");
    await query("insert into bolna_warehouse_contacts values ('9811900011',3120,array['contactNumber'],'funnel')");
    const funnel = await loadFunnel(admin, {});
    expect(row(funnel, ana)).toMatchObject({ warehouseIds: ["77", "3120"], warehouseIdCount: 2, reachedWarehouse: 1 });
    expect(row(funnel, ben)).toMatchObject({ warehouseIds: ["88"], reachedWarehouse: 0.5 });
    expect(funnel.totals).toMatchObject({ warehouseIdCount: 3, warehouseLeads: 2 });
  });

  it("applies the board's filters", async () => {
    const batch = (await query(`insert into bolna_assignment_batches(intent_key,created_by,entity_type,distribution,assignees,selection,request_hash)
      values (gen_random_uuid(),$1,'record','single',array[$2],'{}'::jsonb,'fixture') returning id::text`, [admin.email, ana])).rows[0].id;
    await lead("9811900021", ana, "inbound", { city: "Delhi", batch });
    await lead("9811900022", ana, "rnr", { city: "Pune" });
    await lead("9811900023", ben, "rnr", { city: "Delhi" });
    expect((await loadFunnel(admin, { city: ["Delhi"] })).totals.leads).toBe(2);
    expect((await loadFunnel(admin, { batch: [batch] })).rows.map(r => r.assignee)).toEqual([ana]);
    expect((await loadFunnel(admin, { assignee: [ben] })).rows.map(r => r.assignee)).toEqual([ben]);
  });

  it("is for admins only", async () => {
    await expect(loadFunnel({ email: ana, isAdmin: false }, {})).rejects.toThrow(/admin/i);
  });
});

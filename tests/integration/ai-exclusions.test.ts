import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { query, getPool } from '@/lib/db';
import { assignEntities, previewAssignment } from '@/lib/assignment-allocation';
import { assignmentRequestSchema, requestIdentity, resolveAssignment } from '@/lib/assignment-request';
import { getRawQueueRowsByIds } from '@/lib/raw';
import { assembleBatch } from '@/lib/dispatch-plan';
import { CALLED_CATS } from '@/lib/queue';

const admin = { email: 'admin@test.example', isAdmin: true, name: null };
const caller = 'caller@test.example', other = 'other@test.example';
const allCats = CALLED_CATS.map(category => category.key);

beforeAll(() => {
  if (!process.env.TEST_DATABASE_URL || !['localhost', '127.0.0.1'].includes(new URL(process.env.TEST_DATABASE_URL).hostname)) throw new Error('Disposable local test DB required');
});
beforeEach(async () => {
  await query('truncate bolna_ai_attempts, bolna_assignments, bolna_app_users, bolna_call_logs, raw_phones, raw_records, raw_phone_numbers, call_batches, bolna_dispatch_requests restart identity cascade');
  await query("insert into bolna_app_users(email,role) values($1,'admin'),($2,'employee'),($3,'employee')", [admin.email, caller, other]);
});
afterAll(async () => { await getPool().end(); });

async function listing(phone: string) {
  const id = randomUUID();
  await query("insert into raw_records(id,source,source_record_id,owner_name,state) values($1::uuid,'exclusion-fixture',$1::text,'Synthetic contact','Delhi')", [id]);
  const phoneId = (await query('insert into raw_phone_numbers(phone_last10,phone) values($1,$1) on conflict(phone_last10) do update set phone=excluded.phone returning phone_id', [phone])).rows[0].phone_id;
  await query('insert into raw_phones(master_id,phone_id,is_primary) values($1,$2,true)', [id, phoneId]);
  return { id, phoneId, phone };
}
async function call(row: Awaited<ReturnType<typeof listing>>, status = 'completed', result: string | null = 'Available') {
  const id = randomUUID();
  await query("insert into bolna_call_logs(id,phone_id,to_number,call_type,status,llm_availability,call_created_at) values($1,$2,$3,'outbound',$4,$5,now())", [id,row.phoneId,row.phone,status,result]);
  return id;
}
const options = (ids: string[]) => ({ entity: 'record' as const, ids, assignee: caller, assignedBy: admin.email });

describe('AI-history exclusions in manual and AI calling', () => {
  it('keeps outcome counts stable, splits only eligible work, and records exclusions in the batch', async () => {
    const rows = await Promise.all(Array.from({ length: 6 }, (_, i) => listing(`900000000${i}`)));
    await call(rows[0], 'no-answer', null);
    await call(rows[1], 'failed', null);
    await call(rows[2], 'completed', 'Available');
    await call(rows[3], 'completed', 'Unavailable');
    const opts = { ...options(rows.map(row => row.id)), assignee: undefined, assignees: [caller, other], excludeCats: allCats };
    const initial = await previewAssignment({ ...opts, excludeCats: [] });
    const queue = await getRawQueueRowsByIds(admin, rows.map(row => row.id));
    expect(queue.find(row => row.id === rows[0].id)?.cat).toBe('dead');
    expect(assembleBatch(queue, ['dead']).callable).toHaveLength(5);
    const preview = await previewAssignment(opts);
    expect(preview.aiCategories).toEqual({ dead: 1, unclear: 1, available: 1, unavailable: 1 });
    expect(preview.aiCategories).toEqual(initial.aiCategories);
    expect(preview).toMatchObject({ aiCalled: 4, aiIncluded: 0, excludedAi: 4, eligible: 2, perCaller: { [caller]: 1, [other]: 1 } });
    const result = await assignEntities({ ...opts, expectedPreview: preview.previewHash });
    expect(result).toMatchObject({ assigned: 2, skippedAi: 4, skipped: 4, perCaller: preview.perCaller });
    expect((await query("select count(*)::int n from bolna_assignment_batch_items where batch_id=$1 and disposition='excluded_ai' and assignment_id is null", [result.batchId])).rows[0].n).toBe(4);
    expect((await query('select selection from bolna_assignment_batches where id=$1', [result.batchId])).rows[0].selection.excludeCats).toEqual(allCats);
  });

  it('uses the same exclusions for page IDs and all matching filters', async () => {
    const fresh = await listing('9000000010'), called = await listing('9000000011');
    await call(called);
    for (const selection of [{ ids: [fresh.id, called.id] }, { filters: { state: 'Delhi' } }]) {
      const body = assignmentRequestSchema.parse({ entity_type: 'record', assignee: caller, excludeCats: ['available'], ...selection });
      const { options: opts } = await resolveAssignment(body, admin);
      const preview = await previewAssignment(opts);
      expect(preview).toMatchObject({ requested: 2, eligible: 1, excludedAi: 1 });
      expect(preview.items.find(item => item.disposition === 'assign')?.id).toBe(fresh.id);
    }
  });

  it('excludes every linked listing when AI history is on an alternate number', async () => {
    const first = await listing('9000000020'), linked = await listing('9000000020'), alternate = await listing('9000000021'), fresh = await listing('9000000022');
    await query('insert into raw_phones(master_id,phone_id,is_primary) values($1,$2,false)', [linked.id, alternate.phoneId]);
    await call(alternate);
    const ids = [first.id, linked.id, fresh.id];
    const preview = await previewAssignment({ ...options(ids), excludeCats: ['available'] });
    expect(preview).toMatchObject({ eligible: 1, excludedAi: 2, aiCalled: 2 });
    expect(preview.items.filter(item => item.disposition === 'assign').map(item => item.id)).toEqual([fresh.id]);
    const queue = await getRawQueueRowsByIds(admin, ids);
    expect(assembleBatch(queue, allCats).callable.map(row => row.id)).toEqual([fresh.id]);
  });

  it('preserves open ownership even when reassign is enabled and AI history is excluded', async () => {
    const row = await listing('9000000030');
    await call(row);
    await assignEntities({ ...options([row.id]), assignee: other });
    const held = await previewAssignment({ ...options([row.id]), excludeCats: allCats });
    expect(held).toMatchObject({ owned: 1, eligible: 0 });
    const opts = { ...options([row.id]), excludeCats: allCats, reassign: true };
    const preview = await previewAssignment(opts);
    expect(preview).toMatchObject({ excludedAi: 1, eligible: 0 });
    expect(await assignEntities({ ...opts, expectedPreview: preview.previewHash })).toMatchObject({ assigned: 0, reassigned: 0, skippedAi: 1 });
    expect((await query("select assignee from bolna_assignments where state='open'")).rows).toEqual([{ assignee: other }]);
  });

  it('finds previous calls through the retained phone when a provider snapshot omits its number', async () => {
    const row = await listing('9000000031'), execution = await call(row);
    await query('update bolna_call_logs set to_number=null,from_number=null where id=$1', [execution]);
    const preview = await previewAssignment({ ...options([row.id]), excludeCats: ['available'] });
    expect(preview).toMatchObject({ aiCalled: 1, excludedAi: 1, eligible: 0 });
    expect(preview.items[0].ai?.execution_id).toBe(execution);
  });

  it('rejects a stale preview if new AI history changes the selected exclusion', async () => {
    const row = await listing('9000000040');
    const opts = { ...options([row.id]), excludeCats: ['available' as const] };
    const preview = await previewAssignment(opts);
    expect(preview.eligible).toBe(1);
    await call(row);
    await expect(assignEntities({ ...opts, expectedPreview: preview.previewHash })).rejects.toThrow('Review the refreshed preview');
    expect((await query('select count(*)::int n from bolna_assignments')).rows[0].n).toBe(0);
  });

  it('supports selected AI execution outcomes and does not mark balance-blocked executions as called', async () => {
    const row = await listing('9000000050'), blocked = await listing('9000000051');
    const selected = await call(row, 'no-answer', null), balance = await call(blocked, 'balance-low', null);
    const preview = await previewAssignment({ ...options([selected, balance]), entity: 'call', excludeCats: ['dead'] });
    expect(preview).toMatchObject({ aiCalled: 1, excludedAi: 1, eligible: 1 });
    expect(preview.items.find(item => item.id === selected)?.disposition).toBe('excluded_ai');
    expect(preview.items.find(item => item.id === balance)?.ai_categories).toEqual([]);
  });

  it('includes exclusion choices in idempotency identity and rejects unknown categories', async () => {
    const row = await listing('9000000060');
    const body = assignmentRequestSchema.parse({ entity_type: 'record', ids: [row.id], assignee: caller, intentKey: randomUUID(), excludeCats: ['available'] });
    const { options: opts } = await resolveAssignment(body, admin);
    const first = await assignEntities(opts);
    expect(await assignEntities(opts)).toEqual(first);
    const different = { ...body, excludeCats: ['dead' as const] };
    expect(requestIdentity(different).requestHash).not.toBe(requestIdentity(body).requestHash);
    await expect(assignEntities({ ...opts, ...requestIdentity(different), excludeCats: different.excludeCats })).rejects.toThrow('different request');
    expect(assignmentRequestSchema.safeParse({ ...body, excludeCats: ['bogus'] }).success).toBe(false);
  });
});

import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { query, getPool, transaction } from '@/lib/db';
import { assignEntities } from '@/lib/assignments';
import { PATCH } from '@/app/api/my-work/assignments/[id]/route';
import { PATCH as manualPatch } from '@/app/api/assignments/[id]/route';

const caller = { email: 'caller@employee.test', name: null, isAdmin: false };
const other = { email: 'other@employee.test', name: null, isAdmin: false };
const admin = { email: 'admin@employee.test', name: null, isAdmin: true };
const auth = vi.hoisted(() => ({ user: null as { email: string; name: null; isAdmin: boolean } | null }));
vi.mock('@/lib/auth', () => ({ getCurrentUser: async () => auth.user, getCurrentAdmin: async () => auth.user?.isAdmin ? auth.user : null }));
let id: string, recordId: string, callId: string;
const request = (body: unknown) => new NextRequest('http://localhost/api/my-work/assignments', { method: 'PATCH', body: JSON.stringify(body) });
const patch = (body: unknown) => PATCH(request(body), { params: Promise.resolve({ id }) });
const row = async () => (await query('select * from bolna_assignments where id=$1', [id])).rows[0];

beforeAll(() => {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.TEST_DATABASE_URL!).hostname)) throw Error('Disposable local DB required');
});
beforeEach(async () => {
  await query('truncate bolna_warehouse_imports,bolna_assignments,bolna_assignment_batches,bolna_app_users,bolna_call_logs,raw_records,raw_phones,raw_phone_numbers restart identity cascade');
  await query("insert into bolna_app_users(email,role) values ($1,'employee'),($2,'employee'),($3,'admin')", [caller.email, other.email, admin.email]);
  recordId = randomUUID(); callId = randomUUID();
  const phone = (await query("insert into raw_phone_numbers(phone_last10,phone) values ('9811500001','+919811500001') returning phone_id")).rows[0].phone_id;
  await query("insert into raw_records(id,source,source_record_id) values ($1::uuid,'employee',$1::text)", [recordId]);
  await query('insert into raw_phones(master_id,phone_id,is_primary) values ($1,$2,true)', [recordId, phone]);
  await query("insert into bolna_call_logs(id,phone_id,to_number,status) values ($1,$2,'+919811500001','completed')", [callId, phone]);
  await assignEntities({ entity: 'record', ids: [recordId], assignee: caller.email, assignedBy: admin.email });
  id = (await query('select id::text from bolna_assignments')).rows[0].id;
  auth.user = { ...caller };
});
afterAll(async () => { await getPool().end(); });

describe('preserved employee task workflow', () => {
  it('saves result, notes, DB flag and free-text WH ID, completes and reopens without a call form', async () => {
    expect((await patch({ revision: 0, outcome: 'Available', remarks: 'Existing employee notes', added_to_db: true, wh_id: 'WH-123' })).status).toBe(200);
    expect((await patch({ revision: 1, state: 'done' })).status).toBe(200);
    expect(await row()).toMatchObject({ state: 'done', outcome: 'Available', remarks: 'Existing employee notes', added_to_db: true, wh_id: 'WH-123', revision: 2 });
    expect((await patch({ revision: 2, state: 'open' })).status).toBe(200);
    expect(await row()).toMatchObject({ state: 'open', completed_at: null, revision: 3 });
    expect((await query('select count(*)::int n from bolna_manual_attempts')).rows[0].n).toBe(0);
    const audit = (await query('select actor from bolna_assignment_changes where assignment_id=$1 order by id desc limit 3', [id])).rows;
    expect(audit).toEqual(Array.from({ length: 3 }, () => ({ actor: caller.email })));
  });

  it.each([null, 'Available', 'Unavailable', 'Unclear'])('preserves completion with outcome %s without new closure requirements', async outcome => {
    expect((await patch({ revision: 0, outcome, state: 'done' })).status).toBe(200);
    expect(await row()).toMatchObject({ outcome, state: 'done' });
  });

  it('keeps existing disposition, closure, due date and call evidence when editing employee notes', async () => {
    await query("update bolna_assignments set disposition='owner_unresponsive',next_due_at='2026-11-01',closure_reason='escalated' where id=$1", [id]);
    const before = await row();
    expect((await patch({ revision: 0, remarks: 'New employee note' })).status).toBe(200);
    const after = await row();
    for (const key of ['disposition', 'next_due_at', 'closure_reason', 'outcome_attempt_id', 'last_attempt_at']) expect(after[key]).toEqual(before[key]);
  });

  it('requires authentication, ownership and a matching revision, including for admin My Work', async () => {
    auth.user = null; expect((await patch({ revision: 0, state: 'done' })).status).toBe(401);
    for (const user of [other, admin]) {
      auth.user = user; expect((await patch({ revision: 0, state: 'done' })).status).toBe(409);
    }
    auth.user = caller;
    expect((await patch({ revision: 1, state: 'done' })).status).toBe(409);
    expect(await row()).toMatchObject({ state: 'open', revision: 0 });
    const responses = await Promise.all([patch({ revision: 0, remarks: 'First editor' }), patch({ revision: 0, remarks: 'Second editor' })]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
  });

  it.each([{ state: 'dropped' }, { assignee: other.email }, { closure_reason: 'resolved' }, { revision: undefined }])('rejects fields outside the established employee contract %#', async fields => {
    expect((await patch({ revision: 0, ...fields })).status).toBe(400);
    expect(await row()).toMatchObject({ state: 'open', revision: 0 });
  });

  it('cannot edit dropped work or reopen a contact reassigned to another caller', async () => {
    expect((await patch({ revision: 0, state: 'done' })).status).toBe(200);
    await assignEntities({ entity: 'call', ids: [callId], assignee: other.email, assignedBy: admin.email, reassign: true });
    expect((await patch({ revision: 1, state: 'open' })).status).toBe(409);
    expect(await row()).toMatchObject({ state: 'done', revision: 1 });
    await query("update bolna_assignments set state='dropped' where id=$1", [id]);
    expect((await patch({ revision: 1, remarks: 'Must not save' })).status).toBe(409);
  });

  it('preserves warehouse protection while allowing existing employees to finish their work', async () => {
    await query("insert into bolna_warehouse_imports(name,snapshot_at,source_sha256,summary) values ('employee-test',now(),'fixture','{}')");
    await query("insert into bolna_warehouse_contacts values ('9811500001',123,array['contactNumber'],'employee-test')");
    expect((await patch({ revision: 0, state: 'done', remarks: 'Warehouse already imported' })).status).toBe(200);
    const response = await patch({ revision: 1, state: 'open' });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'WAREHOUSE_ALREADY_ADDED' });
    expect(await row()).toMatchObject({ state: 'done', revision: 1 });
  });

  it('keeps the newer manual-call API validation in force after an employee save', async () => {
    expect((await patch({ revision: 0, remarks: 'Employee save' })).status).toBe(200);
    expect((await manualPatch(request({ revision: 1, state: 'done' }), { params: Promise.resolve({ id }) })).status).toBe(422);
    expect(await row()).toMatchObject({ state: 'open', revision: 1 });
  });

  it.skipIf(process.env.TEST_SHARED_SCHEMA === '1')('keeps native SQL completion validation and limits the transaction opt-in to the owner', async () => {
    expect((await patch({ revision: 0, remarks: 'Employee save' })).status).toBe(200);
    await expect(query("update bolna_assignments set state='done' where id=$1", [id])).rejects.toMatchObject({ code: '23514' });
    await expect(transaction(async client => {
      await client.query("select set_config('bolna.actor',$1,true),set_config('bolna.employee_workflow','classic',true)", [other.email]);
      await client.query("update bolna_assignments set state='done',revision=revision+1 where id=$1", [id]);
    })).rejects.toMatchObject({ code: '23514' });
  });
});

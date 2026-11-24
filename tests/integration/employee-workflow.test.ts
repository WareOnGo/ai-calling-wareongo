import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { query, getPool, transaction } from '@/lib/db';
import { assignEntities } from '@/lib/assignments';
import { GET, PATCH } from '@/app/api/my-work/assignments/[id]/route';
import { PATCH as manualPatch } from '@/app/api/assignments/[id]/route';

const caller = { email: 'caller@employee.test', name: null, isAdmin: false };
const other = { email: 'other@employee.test', name: null, isAdmin: false };
const admin = { email: 'admin@employee.test', name: null, isAdmin: true };
const auth = vi.hoisted(() => ({ user: null as { email: string; name: null; isAdmin: boolean } | null }));
vi.mock('@/lib/auth', () => ({ getCurrentUser: async () => auth.user, getCurrentAdmin: async () => auth.user?.isAdmin ? auth.user : null }));
let id: string, recordId: string, callId: string;
const request = (body: unknown, employee?: string) => new NextRequest(`http://localhost/api/my-work/assignments${employee ? `?${new URLSearchParams({ employee })}` : ''}`, { method: 'PATCH', body: JSON.stringify(body) });
const patch = (body: unknown, employee?: string) => PATCH(request(body, employee), { params: Promise.resolve({ id }) });
const latest = (assignmentId = id, employee?: string) => GET(new NextRequest(`http://localhost/api/my-work/assignments${employee ? `?${new URLSearchParams({ employee })}` : ''}`), {params:Promise.resolve({id:assignmentId})});
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

describe('admin editing employee work', () => {
  it('edits all task fields, completes and reopens while retaining the employee and auditing the admin', async () => {
    auth.user = admin;
    expect((await patch({ revision: 0, outcome: 'Available', remarks: 'Admin correction', added_to_db: true, wh_id: 'WH-123' }, ` ${caller.email.toUpperCase()} `)).status).toBe(200);
    expect((await patch({ revision: 1, state: 'done' }, caller.email)).status).toBe(200);
    expect(await row()).toMatchObject({ assignee: caller.email, state: 'done', outcome: 'Available', remarks: 'Admin correction', added_to_db: true, wh_id: 'WH-123', revision: 2 });
    expect((await patch({ revision: 2, state: 'open' }, caller.email)).status).toBe(200);
    expect(await row()).toMatchObject({ assignee: caller.email, state: 'open', completed_at: null, revision: 3 });
    const response = await latest(id, caller.email);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ remarks: 'Admin correction', revision: 3 });
    expect((await query('select actor from bolna_assignment_changes where assignment_id=$1 order by id desc limit 3', [id])).rows).toEqual(Array.from({ length: 3 }, () => ({ actor: admin.email })));
    expect((await query('select count(*)::int n from bolna_manual_attempts')).rows[0].n).toBe(0);
  });

  it('applies the same editing contract to AI follow-ups', async () => {
    await query("update bolna_assignments set state='dropped' where id=$1", [id]);
    await assignEntities({ entity: 'call', ids: [callId], assignee: caller.email, assignedBy: admin.email });
    id = (await query("select id::text from bolna_assignments where entity_type='call'")).rows[0].id;
    auth.user = admin;
    expect((await patch({ revision: 0, remarks: 'Admin follow-up', state: 'done' }, caller.email)).status).toBe(200);
    expect(await row()).toMatchObject({ assignee: caller.email, state: 'done', remarks: 'Admin follow-up' });
  });

  it('requires admin access and a matching employee scope for both reads and writes', async () => {
    for (const user of [null, other, { ...admin, isAdmin: false, canSwitchView: true }]) {
      auth.user = user;
      expect((await latest(id, caller.email)).status).toBe(user ? 403 : 401);
      expect((await patch({ revision: 0, remarks: 'Must not save' }, caller.email)).status).toBe(user ? 403 : 401);
    }
    auth.user = admin;
    for (const employee of [undefined, other.email]) {
      expect((await latest(id, employee)).status).toBe(404);
      expect((await patch({ revision: 0, remarks: 'Wrong employee' }, employee)).status).toBe(409);
    }
    expect(await row()).toMatchObject({ revision: 0, remarks: null });
  });

  it('rejects unknown and inactive employees, and immediately respects revoked admin access', async () => {
    auth.user = admin;
    await query('update bolna_app_users set active=false where email=$1', [caller.email]);
    for (const employee of [caller.email, 'missing@employee.test']) {
      expect((await latest(id, employee)).status).toBe(404);
      expect((await patch({ revision: 0, state: 'done' }, employee)).status).toBe(404);
    }
    await query('update bolna_app_users set active=true where email=$1', [caller.email]);
    auth.user = { ...admin, isAdmin: false };
    expect((await patch({ revision: 0, state: 'done' }, caller.email)).status).toBe(403);
    expect(await row()).toMatchObject({ revision: 0, state: 'open' });
  });

  it('protects concurrent employee changes and allows an explicit revision-based correction', async () => {
    expect((await patch({ revision: 0, remarks: 'Employee change' })).status).toBe(200);
    auth.user = admin;
    const stale = await patch({ revision: 0, remarks: 'Admin correction' }, caller.email);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: 'ASSIGNMENT_CONFLICT' });
    expect(await (await latest(id, caller.email)).json()).toMatchObject({ revision: 1, remarks: 'Employee change' });
    expect((await patch({ revision: 1, remarks: 'Admin correction' }, caller.email)).status).toBe(200);
    expect(await row()).toMatchObject({ revision: 2, remarks: 'Admin correction', assignee: caller.email });
  });

  it('cannot reopen reassigned contacts, edit dropped work or change ownership', async () => {
    auth.user = admin;
    expect((await patch({ revision: 0, state: 'done' }, caller.email)).status).toBe(200);
    await assignEntities({ entity: 'call', ids: [callId], assignee: other.email, assignedBy: admin.email, reassign: true });
    expect((await patch({ revision: 1, state: 'open' }, caller.email)).status).toBe(409);
    for (const fields of [{ assignee: other.email }, { state: 'dropped' }, { closure_reason: 'resolved' }]) {
      expect((await patch({ revision: 1, ...fields }, caller.email)).status).toBe(400);
    }
    await query("update bolna_assignments set state='dropped',revision=revision+1 where id=$1", [id]);
    expect((await latest(id, caller.email)).status).toBe(404);
    expect((await patch({ revision: 2, remarks: 'Unavailable' }, caller.email)).status).toBe(409);
  });

  it('preserves the warehouse reopening guard for admin edits', async () => {
    auth.user = admin;
    await query("insert into bolna_warehouse_imports(name,snapshot_at,source_sha256,summary) values ('admin-work-test',now(),'fixture','{}')");
    await query("insert into bolna_warehouse_contacts values ('9811500001',123,array['contactNumber'],'admin-work-test')");
    expect((await patch({ revision: 0, state: 'done' }, caller.email)).status).toBe(200);
    const response = await patch({ revision: 1, state: 'open' }, caller.email);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'WAREHOUSE_ALREADY_ADDED' });
  });

  it.skipIf(process.env.TEST_SHARED_SCHEMA === '1')('keeps the database exception limited to active admins and classic fields', async () => {
    const finish = (extra = '') => transaction(async client => {
      await client.query("select set_config('bolna.actor',$1,true),set_config('bolna.employee_workflow','classic',true)", [admin.email]);
      return client.query(`update bolna_assignments set state='done',revision=revision+1${extra} where id=$1`, [id]);
    });
    await query('update bolna_app_users set active=false where email=$1', [admin.email]);
    await expect(finish()).rejects.toMatchObject({ code: '23514' });
    await query("update bolna_app_users set active=true,role='employee' where email=$1", [admin.email]);
    await expect(finish()).rejects.toMatchObject({ code: '23514' });
    await query("update bolna_app_users set role='admin' where email=$1", [admin.email]);
    await expect(finish(",note='Changed assignment instructions'")).rejects.toMatchObject({ code: '23514' });
    expect((await finish()).rowCount).toBe(1);
  });
});
describe('preserved employee task workflow', () => {
  it('returns the latest editable fields and version for conflict review without caching', async () => {
    expect((await patch({revision:0,remarks:'Saved elsewhere',wh_id:'3271'})).status).toBe(200);
    const stale=await patch({revision:0,remarks:'My draft'});
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({code:'ASSIGNMENT_CONFLICT'});
    const response=await latest();
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({id,revision:1,state:'open',outcome:null,remarks:'Saved elsewhere',wh_id:'3271',added_to_db:false});
    expect((await patch({revision:1,remarks:'My draft'})).status).toBe(200);
    expect(await row()).toMatchObject({revision:2,remarks:'My draft',wh_id:'3271'});
    expect((await patch({revision:1,remarks:'Raced review'})).status).toBe(409);
  });

  it('scopes conflict reads to the current owner, including admin My Work, and hides unavailable rows', async () => {
    auth.user=null; expect((await latest()).status).toBe(401);
    for (const user of [other,admin]) { auth.user=user; expect((await latest()).status).toBe(404); }
    auth.user=caller;
    expect((await latest('0')).status).toBe(400);
    expect((await latest('9223372036854775808')).status).toBe(400);
    expect((await latest('999999')).status).toBe(404);
    await query("update bolna_assignments set state='dropped',revision=revision+1 where id=$1",[id]);
    expect((await latest()).status).toBe(404);
    const response=await patch({revision:0,remarks:'Keep draft'});
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({code:'ASSIGNMENT_CONFLICT'});
  });

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

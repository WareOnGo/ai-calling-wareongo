import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {NextRequest} from 'next/server';
import {getPool, query} from '@/lib/db';
import {assignEntities} from '@/lib/assignments';
import {updateMyWorkAssignment as updateAssignment} from '@/lib/employee-assignments';
import {upsertUser} from '@/lib/users';
import {POST as assign} from '@/app/api/assignments/route';
import {PATCH as patch} from '@/app/api/my-work/assignments/[id]/route';
import {POST as dispatch} from '@/app/api/raw/dispatch/route';

const admin = {email: 'admin@schema.test', isAdmin: true, name: null};
const caller = {email: 'caller@schema.test', isAdmin: false, name: null};
const auth = vi.hoisted(() => ({user: {email: 'admin@schema.test', isAdmin: true, name: null}}));
vi.mock('@/lib/auth', () => ({getCurrentUser: async () => auth.user, getCurrentAdmin: async () => auth.user.isAdmin ? auth.user : null}));
const request = (path: string, body: unknown, method = 'POST') => new NextRequest(`http://localhost${path}`, {method, body: JSON.stringify(body)});
let registered: string, free: string, retainedCall: string;

// The upgrade rehearsal reproduces production’s retained trigger configuration.
describe.skipIf(process.env.TEST_SHARED_SCHEMA !== '1')('main on the retained shared schema', () => {
  beforeAll(async () => {
    expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(process.env.TEST_DATABASE_URL!).hostname);
    const triggers = (await query("select tgname,tgenabled from pg_trigger where tgname in ('bolna_assignment_quality_guard','bolna_assignment_contacts_sync','bolna_warehouse_assignment_guard','bolna_warehouse_ai_batch_guard') order by tgname")).rows;
    expect(triggers).toEqual([
      {tgname: 'bolna_assignment_contacts_sync', tgenabled: 'D'},
      {tgname: 'bolna_assignment_quality_guard', tgenabled: 'D'},
      {tgname: 'bolna_warehouse_ai_batch_guard', tgenabled: 'O'},
      {tgname: 'bolna_warehouse_assignment_guard', tgenabled: 'O'},
    ]);
  });
  beforeEach(async () => {
    await query('truncate bolna_warehouse_imports,bolna_assignments,bolna_app_users,bolna_call_logs,bolna_webhook_events,raw_records,raw_phones,raw_phone_numbers,call_batches,bolna_dispatch_requests restart identity cascade');
    await query("insert into bolna_app_users(email,role) values ($1,'admin'),($2,'employee')", [admin.email, caller.email]);
    registered = randomUUID(); free = randomUUID(); retainedCall = randomUUID();
    for (const [id, phone] of [[registered, '9811300001'], [free, '9811300002']]) {
      await query("insert into raw_records(id,source,source_record_id,owner_name,city,state) values ($1::uuid,'schema-test',$1::text,'Test owner','Delhi','Delhi')", [id]);
      const p = (await query('insert into raw_phone_numbers(phone_last10,phone) values ($1,$1) returning phone_id', [phone])).rows[0].phone_id;
      await query('insert into raw_phones(master_id,phone_id,is_primary) values ($1,$2,true)', [id,p]);
    }
    await query("insert into bolna_call_logs(id,status,phone_id) select $1,'completed',phone_id from raw_phone_numbers where phone_last10='9811300001'", [retainedCall]);
    auth.user = {...admin};
    vi.stubGlobal('fetch', vi.fn(async () => { throw Error('Unexpected external request'); }));
  });
  afterEach(async () => { vi.unstubAllGlobals(); await query('truncate bolna_warehouse_imports cascade'); });
  afterAll(async () => { await getPool().end(); });

  async function registerWarehouse() {
    await query("insert into bolna_warehouse_imports(name,snapshot_at,source_sha256,summary) values ('test',now(),'fixture','{}')");
    await query("insert into bolna_warehouse_contacts values ('9811300001',123,array['contactNumber'],'test')");
  }
  async function episode(state = 'open') {
    return (await query("insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state,remarks) values ('record',$1,$2,$3,$4,'Keep existing notes') returning id::text", [registered,caller.email,admin.email,state])).rows[0].id as string;
  }
  async function warehouseConflict(response: Response) {
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({code: 'WAREHOUSE_ALREADY_ADDED', error: expect.stringContaining('warehouse')});
  }

  it('keeps ordinary legacy saving, completion and reopening working without manual-attempt logging', async () => {
    expect(await assignEntities({entity: 'record', ids: [free], assignee: caller.email, assignedBy: admin.email})).toMatchObject({assigned: 1});
    const id = (await query('select id::text from bolna_assignments')).rows[0].id;
    expect(await updateAssignment(id, caller, {revision: 0, outcome: 'Available', whId: '321', remarks: 'Verified by the caller', state: 'done'})).toMatchObject({state: 'done', revision: 1});
    expect(await updateAssignment(id, caller, {revision: 1, state: 'open'})).toMatchObject({state: 'open', revision: 2});
    expect((await query('select count(*)::int n from bolna_manual_attempts')).rows[0].n).toBe(0);
    expect((await query('select count(*)::int n from bolna_assignment_changes')).rows[0].n).toBe(3);
  });

  it('preserves Callyzer linkage and newer assignment fields during legacy edits', async () => {
    await query("update bolna_app_users set callyzer_number='91-9811300001',callyzer_tracking_since='2026-10-01',callyzer_device='{\"name\":\"Test device\"}' where email=$1", [caller.email]);
    const before = (await query('select callyzer_number,callyzer_tracking_since,callyzer_device from bolna_app_users where email=$1', [caller.email])).rows[0];
    expect(await upsertUser({email: caller.email, name: 'Updated caller'})).toMatchObject({name: 'Updated caller'});
    expect((await query('select callyzer_number,callyzer_tracking_since,callyzer_device from bolna_app_users where email=$1', [caller.email])).rows[0]).toEqual(before);
    const id = await episode();
    await query("update bolna_assignments set disposition='owner_unresponsive',next_due_at='2026-11-01',closure_reason='escalated' where id=$1", [id]);
    await updateAssignment(id, caller, {revision: 0, remarks: 'Updated through legacy app'});
    expect((await query('select disposition,next_due_at::date::text due,closure_reason from bolna_assignments where id=$1', [id])).rows[0]).toEqual({disposition: 'owner_unresponsive', due: '2026-11-01', closure_reason: 'escalated'});
  });

  it.each(['record', 'call'] as const)('skips registered warehouses when allocating %s work without losing existing work', async entity => {
    await registerWarehouse();
    const ids = entity === 'record' ? [free, registered] : [retainedCall];
    const response = await assign(request('/api/assignments', {entity_type: entity, ids, assignee: caller.email}));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({assigned: entity === 'record' ? 1 : 0, skippedWarehouse: 1});
    expect((await query('select entity_id from bolna_assignments')).rows).toEqual(entity === 'record' ? [{entity_id: free}] : []);
  });

  it('keeps the original owner and notes when a guarded reassignment is skipped', async () => {
    const id = await episode(); await registerWarehouse();
    const response = await assign(request('/api/assignments', {entity_type: 'record', ids: [registered], assignee: admin.email, reassign: true}));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({assigned: 0, skippedWarehouse: 1});
    expect((await query('select id::text,state,assignee,remarks,revision from bolna_assignments')).rows).toEqual([{id,state: 'open',assignee: caller.email,remarks: 'Keep existing notes',revision: 0}]);
  });

  it('rejects guarded reopening without changing completion or revision', async () => {
    const id = await episode('done'); await registerWarehouse(); auth.user = {...caller};
    await warehouseConflict(await patch(request(`/api/assignments/${id}`, {state: 'open', revision: 0}, 'PATCH'), {params: Promise.resolve({id})}));
    expect((await query('select state,revision from bolna_assignments where id=$1', [id])).rows[0]).toEqual({state: 'done',revision: 0});
  });

  it('allows notes and completion on an existing assignment after its warehouse is imported', async () => {
    const id = await episode(); await registerWarehouse(); auth.user = {...caller};
    const result = await patch(request(`/api/assignments/${id}`, {remarks: 'Existing work completed', outcome: 'Available', wh_id: '123', state: 'done', revision: 0}, 'PATCH'), {params: Promise.resolve({id})});
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({state: 'done',revision: 1});
  });

  it('rejects an entirely registered AI selection before contacting the provider or retaining reservations', async () => {
    await registerWarehouse();
    const response = await dispatch(request('/api/raw/dispatch', {ids: [registered], intentKey: randomUUID(), confirm: true, routingMode: 'hindi'}));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({error: expect.stringContaining('warehouses already added')});
    expect(fetch).not.toHaveBeenCalled();
    for (const table of ['bolna_dispatch_requests','call_batches','call_batch_items','bolna_dispatch_reservations']) {
      expect((await query(`select count(*)::int n from ${table}`)).rows[0].n).toBe(0);
    }
  });
});

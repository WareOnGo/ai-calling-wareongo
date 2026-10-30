import {readFile} from 'node:fs/promises';
import {afterAll,it,expect} from 'vitest';
import {getPool} from '@/lib/db';
afterAll(()=>getPool().end());

it('adds hourly dispatch to the existing cron, preserving identity, cadence, enrichment and independent failure handling',async()=>{
  const c=await getPool().connect();
  try {
    await c.query('begin');
    await c.query(`create schema cron; create schema net; create schema vault;
      create table cron.job(jobid bigint primary key,jobname text,schedule text,command text,active boolean);
      insert into cron.job values(4,'enrich-analysis','*/10 * * * *',' select call_enrich_endpoint(); ',true),
        (8,'unrelated','*/2 * * * *','select unrelated();',false);
      create function cron.alter_job(job_id bigint,command text) returns void language sql as $$update cron.job set command=$2 where jobid=$1$$;
      create table vault.decrypted_secrets(name text,decrypted_secret text);
      insert into vault.decrypted_secrets values('process_secret','test-worker-secret');
      create table net.requests(url text,headers jsonb,body jsonb,timeout_ms integer);
      create function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds integer default 1000)
        returns bigint language plpgsql as $$begin
          if current_setting('test.warehouse_enqueue_fail',true)='on' then raise exception 'warehouse enqueue failed'; end if;
          insert into net.requests values(url,headers,body,timeout_milliseconds);return 1;end$$;
      create table public.enrich_test_runs(n int);
      create function public.call_app_endpoint(path text) returns void language plpgsql as $$begin
        if current_setting('test.enrich_enqueue_fail',true)='on' then raise exception 'enrich enqueue failed'; end if;
        insert into public.enrich_test_runs values(1);end$$;
      -- Mirror production: the original helper uses an unqualified inner call.
      create function public.call_enrich_endpoint() returns void language plpgsql security definer as $$begin perform call_app_endpoint('/api/enrich');end$$;
      update bolna_warehouse_sync_state set enabled=true,next_attempt_at=clock_timestamp(),lease_token=null,lease_until=null;
    `);
    const before=(await c.query("select pg_get_functiondef('public.call_enrich_endpoint()'::regprocedure) def")).rows[0].def;
    const sql=await readFile(new URL('../../database/schedule-warehouse-sync.sql',import.meta.url),'utf8');
    await c.query(sql);await c.query(sql);
    expect((await c.query('select * from cron.job order by jobid')).rows).toEqual([
      {jobid:'4',jobname:'enrich-analysis',schedule:'*/10 * * * *',command:'select public.call_enrich_and_warehouse_endpoint();',active:true},
      {jobid:'8',jobname:'unrelated',schedule:'*/2 * * * *',command:'select unrelated();',active:false},
    ]);
    expect((await c.query("select pg_get_functiondef('public.call_enrich_endpoint()'::regprocedure) def")).rows[0].def).toBe(before);
    expect((await c.query('select count(*)::int n from net.requests')).rows[0].n).toBe(0);
    await c.query('select public.call_enrich_and_warehouse_endpoint()');
    expect((await c.query('select * from net.requests')).rows).toEqual([{
      url:'https://ai-calling-wareongo.vercel.app/api/warehouses/sync',headers:{'Content-Type':'application/json',Authorization:'Bearer test-worker-secret'},body:{},timeout_ms:110000,
    }]);
    expect((await c.query('select count(*)::int n from enrich_test_runs')).rows[0].n).toBe(1);
    // Due gate suppresses just the warehouse request, including a running lease.
    for(const state of ["enabled=false","enabled=true,next_attempt_at=clock_timestamp()+interval '1 hour'",
      "next_attempt_at=clock_timestamp(),lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '1 minute'"]) {
      await c.query(`update bolna_warehouse_sync_state set ${state}`);
      await c.query('select public.call_enrich_and_warehouse_endpoint()');
    }
    expect((await c.query('select count(*)::int n from net.requests')).rows[0].n).toBe(1);
    expect((await c.query('select count(*)::int n from enrich_test_runs')).rows[0].n).toBe(4);
    await c.query("update bolna_warehouse_sync_state set lease_token=null,lease_until=null; set local test.enrich_enqueue_fail='on'");
    await c.query('select public.call_enrich_and_warehouse_endpoint()');
    expect((await c.query('select count(*)::int n from net.requests')).rows[0].n).toBe(2);
    await c.query("set local test.enrich_enqueue_fail='off'; set local test.warehouse_enqueue_fail='on'");
    await c.query('select public.call_enrich_and_warehouse_endpoint()');
    expect((await c.query('select count(*)::int n from enrich_test_runs')).rows[0].n).toBe(5);
    expect((await c.query('select count(*)::int n from net.requests')).rows[0].n).toBe(2);
    const access=(await c.query(`select prosecdef,proconfig,
      exists(select 1 from aclexplode(proacl) where grantee=0 and privilege_type='EXECUTE') public_execute
      from pg_proc where oid in ('public.call_warehouse_sync_endpoint()'::regprocedure,'public.call_enrich_and_warehouse_endpoint()'::regprocedure)`)).rows;
    expect(access).toEqual(Array(2).fill({prosecdef:true,proconfig:['search_path=""'],public_execute:false}));
    await c.query("update cron.job set command='select different()' where jobid=4; savepoint collision");
    await expect(c.query(sql)).rejects.toThrow('A different enrich-analysis command exists');
    await c.query('rollback to savepoint collision; rollback');
    expect((await c.query("select to_regprocedure('public.call_enrich_and_warehouse_endpoint()') fn,to_regnamespace('cron') cron")).rows[0]).toEqual({fn:null,cron:null});
  } finally {await c.query('rollback');c.release();}
});

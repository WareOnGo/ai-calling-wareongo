import {readFile} from 'node:fs/promises';
import {afterAll,it,expect} from 'vitest';
import {getPool} from '@/lib/db';

afterAll(()=>getPool().end());

it.each([
  {file:'schedule-batch-polling.sql',name:'reconcile-batches',fn:'call_batch_reconcile_endpoint',endpoint:'/api/batches/reconcile',timeout:280000},
  {file:'schedule-callyzer.sql',name:'sync-callyzer',fn:'call_callyzer_sync_endpoint',endpoint:'/api/callyzer/sync',timeout:55000},
])('installs one private $name job, queues authenticated requests, and rolls back cleanly',async({file,name,fn,endpoint,timeout})=>{
  expect(new URL(process.env.TEST_DATABASE_URL!).hostname).toBe('127.0.0.1');
  const client=await getPool().connect();
  try {
    await client.query('begin');
    // Isolated SQL stand-ins: no HTTP request or real cron worker can run here.
    await client.query(`
      create schema cron; create schema net; create schema vault;
      create table cron.job(jobid bigserial,jobname text unique,schedule text,command text,active boolean default true);
      create function cron.schedule(job_name text,spec text,sql_command text) returns bigint language sql as $$
        insert into cron.job(jobname,schedule,command) values(job_name,spec,sql_command)
        on conflict(jobname) do update set schedule=excluded.schedule,command=excluded.command,active=true returning jobid
      $$;
      create table vault.decrypted_secrets(name text,decrypted_secret text);
      insert into vault.decrypted_secrets values('process_secret','test-worker-secret');
      create table net.requests(id bigserial,url text,headers jsonb,body jsonb,timeout_ms integer);
      create function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds integer default 1000)
        returns bigint language sql as $$
          insert into net.requests(url,body,headers,timeout_ms) values(url,body,headers,timeout_milliseconds) returning id
        $$;
    `);
    const sql=await readFile(new URL(`../../database/${file}`,import.meta.url),'utf8');
    await client.query(sql);
    await client.query(sql);
    expect((await client.query('select jobname,schedule,command,active from cron.job')).rows).toEqual([
      {jobname:name,schedule:'*/5 * * * *',command:`select public.${fn}();`,active:true},
    ]);
    expect((await client.query('select count(*)::int n from net.requests')).rows[0].n).toBe(0);
    await client.query(`select public.${fn}()`);
    expect((await client.query('select url,headers,body,timeout_ms from net.requests')).rows).toEqual([
      {url:`https://ai-calling-wareongo.vercel.app${endpoint}`,headers:{'Content-Type':'application/json',Authorization:'Bearer test-worker-secret'},body:{},timeout_ms:timeout},
    ]);
    const access=(await client.query(`select p.prosecdef,
      exists(select 1 from aclexplode(p.proacl) a where grantee=0 and privilege_type='EXECUTE') public_execute,
      p.proconfig from pg_proc p where oid=$1::regprocedure`,[`public.${fn}()`])).rows[0];
    expect(access).toMatchObject({prosecdef:true,public_execute:false,proconfig:['search_path=""']});
    await client.query("update cron.job set command='select unrelated_job()'");
    await client.query('savepoint collision');
    await expect(client.query(sql)).rejects.toThrow(`A different ${name} job already exists`);
    await client.query('rollback to savepoint collision');
    await client.query('delete from vault.decrypted_secrets');
    await client.query('savepoint missing_secret');
    await expect(client.query(`select public.${fn}()`)).rejects.toThrow();
    await client.query('rollback to savepoint missing_secret');
    expect((await client.query('select count(*)::int n from net.requests')).rows[0].n).toBe(1);
    await client.query('rollback');
    expect((await client.query("select to_regprocedure($1) fn,to_regnamespace('cron') cron",[`public.${fn}()`])).rows[0]).toEqual({fn:null,cron:null});
  } finally {
    await client.query('rollback');client.release();
  }
});

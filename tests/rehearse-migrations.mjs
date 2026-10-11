import pg from "pg";
import {backfillAiEvidence} from "../database/backfill-ai-evidence.mjs";
import { readFile,readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { randomUUID,createHash } from "node:crypto";
import assert from "node:assert/strict";
const target=new URL(process.env.TEST_DATABASE_URL||"");
if(target.hostname!=="127.0.0.1"||target.port!=="55439")throw new Error("Dedicated handoff test cluster required");
const admin=new pg.Client({connectionString:target.href,ssl:false});await admin.connect();
const report=[];
for(const mode of ["fresh","legacy","current","interrupted"]){
  const legacy=mode!=="fresh";
  const name=`bolna_rehearsal_${randomUUID().replaceAll('-','')}`;
  await admin.query(`create database ${name}`);
  const url=new URL(target);url.pathname=`/${name}`;
  const db=new pg.Client({connectionString:url.href,ssl:false});await db.connect();
  try{
    await db.query("create table customer_canary(id integer primary key, value text);insert into customer_canary values(1,'preserve co-tenant data')");
    if(legacy){
      await db.query(await readFile('database/baseline.sql','utf8'));
      if(mode==="current"||mode==="interrupted"){
        await db.query("create table bolna_schema_migrations(name text primary key,checksum text not null,applied_at timestamptz not null default now())");
        for(const file of ["baseline.sql",...(await readdir('database/migrations')).filter(f=>/^00[1-5]_.*\.sql$/.test(f)).sort()]){
          const sql=await readFile(file==="baseline.sql"?"database/baseline.sql":`database/migrations/${file}`,'utf8');
          if(file!=="baseline.sql")await db.query(sql);
          await db.query('insert into bolna_schema_migrations(name,checksum) values($1,$2)',[file,createHash('sha256').update(sql).digest('hex')]);
        }
      }
      await db.query(`insert into bolna_app_users(email,role) values('admin@test.example','admin'),('a@test.example','employee'),('b@test.example','employee');
        insert into raw_records(id,source,source_record_id) values('a0000000-0000-4000-8000-000000000001','fixture','one'),('a0000000-0000-4000-8000-000000000002','fixture','two');
        insert into raw_phone_numbers(phone_last10,phone) values('9876543210','+919876543210');
        insert into raw_phones(master_id,phone_id) select r.id,p.phone_id from raw_records r cross join raw_phone_numbers p;
        insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state,outcome,remarks) values
          ('record','a0000000-0000-4000-8000-000000000001','a@test.example','admin@test.example','open',null,null),
          ('record','a0000000-0000-4000-8000-000000000002','b@test.example','admin@test.example','open',null,null),
          ('record','a0000000-0000-4000-8000-000000000001','a@test.example','admin@test.example','done','Available','Call back later');`);
      const retained={id:'c0000000-0000-4000-8000-000000000001',status:'completed',batch_id:'retained-batch',retry_count:2,
        initiated_at:'2026-08-01T04:00:00Z',updated_at:'2026-08-01T04:01:00Z',conversation_duration:45,transcript:'user: Yes, available.',
        telephony_data:{provider_call_id:'retained-call',call_type:'outbound',to_number:'+919876543210',duration:50}};
      const sparse={id:retained.id,updated_at:'2026-08-01T04:02:00Z',conversation_duration:45,transcript:'user: Yes, available.',telephony_data:{provider_call_id:'retained-call'}};
      await db.query("insert into bolna_call_logs(id,raw,wh_id,added_to_db) values($1,$2,'WH-789',true)",[retained.id,retained]);
      await db.query("insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state,outcome) values('call',$1,'a@test.example','admin@test.example','done','Available')",[retained.id]);
      await db.query('insert into bolna_webhook_events(id,raw) values($1,$2)',[sparse.id,sparse]);
    }
    const migrate=()=>{
      const run=spawnSync(process.execPath,['database/migrate.mjs',...(!legacy&&!report.some(r=>r.database===name)?['--init']:[])],{
        env:{...process.env,DIRECT_URL:url.href,DATABASE_URL:url.href,DATABASE_SSL:'disable'},encoding:'utf8'});
      assert.equal(run.status,0,run.stderr||run.stdout);return run.stdout;
    };
    if(mode==='interrupted'){
      await db.query(`create table bolna_backfill_progress(name text primary key,after_id uuid,updated_at timestamptz not null default now());
       create function fail_migration_backfill() returns trigger language plpgsql as $$ begin
        if NEW.name like '%webhook%' then raise exception 'injected migration backfill failure'; end if;return NEW;end $$;
       create trigger fail_migration_backfill before insert or update on bolna_backfill_progress for each row execute function fail_migration_backfill()`);
      const failed=spawnSync(process.execPath,['database/migrate.mjs'],{env:{...process.env,DIRECT_URL:url.href,DATABASE_URL:url.href,DATABASE_SSL:'disable'},encoding:'utf8'});
      assert.notEqual(failed.status,0);assert.match(failed.stderr,/injected migration backfill failure/);
      assert.equal((await db.query("select count(*)::int n from bolna_schema_migrations where name ~ '^[0-9]' and name >= '015'")).rows[0].n,0);
      assert.ok((await db.query("select to_regprocedure('bolna_merge_ai_payload(jsonb,jsonb)') name")).rows[0].name);
      assert.equal((await db.query('select count(*)::int n from bolna_backfill_progress')).rows[0].n,1,'Earlier recovery page committed before failure');
      await db.query('drop function fail_migration_backfill() cascade');
    }
    const applied=migrate();report.push({database:name,legacy,applied:applied.trim()});
    // Second invocation must leave data and migration checksums intact.
    const repeated=spawnSync(process.execPath,['database/migrate.mjs'],{env:{...process.env,DIRECT_URL:url.href,DATABASE_URL:url.href,DATABASE_SSL:'disable'},encoding:'utf8'});
    assert.equal(repeated.status,0,repeated.stderr);assert.match(repeated.stdout,/up to date/);
    assert.equal((await db.query('select value from customer_canary')).rows[0].value,'preserve co-tenant data');
    const expectedMigrations=(await readdir('database/migrations')).filter(file=>file.endsWith('.sql'));
    assert.equal((await db.query('select count(*)::int n from bolna_schema_migrations')).rows[0].n,expectedMigrations.length+1);
    assert.deepEqual((await db.query("select bolna_valid_warehouse(' 17 ') valid,bolna_valid_warehouse('N/A') placeholder")).rows[0],{valid:true,placeholder:false});
    if(legacy){
      assert.equal((await db.query('select count(*) n from bolna_assignments')).rows[0].n,'4');
      assert.equal((await db.query('select count(*) n from bolna_assignment_quality_review')).rows[0].n,'2');
      assert.equal((await db.query("select to_regclass('bolna_assignment_contact_claims') name")).rows[0].name,null);
      assert.deepEqual((await db.query("select wh_id,added_to_db,legacy_onboarding from bolna_assignments where entity_type='call'")).rows[0],{wh_id:'WH-789',added_to_db:true,legacy_onboarding:true});
      assert.equal((await db.query('select count(*) n from bolna_assignment_changes')).rows[0].n,'0','No invented historical verification timestamps');
      assert.equal((await db.query('select count(*) n from bolna_ai_attempts')).rows[0].n,'1');
      assert.deepEqual((await db.query('select provider_call_id,status,batch_id,phone_last10,duration_seconds::int,confirmed_conversation,raw->>\'retry_count\' retry_index from bolna_ai_attempts')).rows,
        [{provider_call_id:'retained-call',status:'completed',batch_id:'retained-batch',phone_last10:'9876543210',duration_seconds:50,confirmed_conversation:true,retry_index:'2'}]);
      // Prove cursor/evidence atomicity after a committed page and a failed page.
      await db.query('truncate bolna_ai_attempts cascade; truncate bolna_backfill_progress');
      assert.deepEqual(await backfillAiEvidence(db,{batchSize:1,maxBatches:1}),{batches:1,complete:false});
      await db.query(`create function fail_backfill_fixture() returns trigger language plpgsql as $$ begin
       if NEW.name like '%webhook%' then raise exception 'injected cursor failure'; end if;return NEW;end $$;
       create trigger fail_backfill_fixture before insert or update on bolna_backfill_progress for each row execute function fail_backfill_fixture()`);
      await assert.rejects(backfillAiEvidence(db,{batchSize:1}),/injected cursor failure/);
      assert.equal((await db.query('select count(*) n from bolna_ai_attempts')).rows[0].n,'1');
      assert.equal(new Date((await db.query('select provider_updated_at from bolna_ai_attempts')).rows[0].provider_updated_at).toISOString(),'2026-08-01T04:01:00.000Z','Failed page did not change the retained dial');
      await db.query('drop function fail_backfill_fixture() cascade');
      assert.equal((await backfillAiEvidence(db,{batchSize:1})).complete,true);
      assert.equal((await db.query('select count(*) n from bolna_ai_attempts')).rows[0].n,'1');
      assert.equal((await backfillAiEvidence(db,{batchSize:1})).batches,0);
      assert.equal(new Date((await db.query('select provider_updated_at from bolna_ai_attempts')).rows[0].provider_updated_at).toISOString(),'2026-08-01T04:02:00.000Z','Retry committed the sparse update');
      await assert.rejects(db.query("update bolna_assignments set outcome='Available',state='done' where id=1"),{code:'23514'});
      await db.query("update bolna_assignments set state='open' where id=3").then(()=>assert.fail('Existing entity owner must reject reopen'),error=>assert.equal(error.code,'23505'));
    }
    await db.query(await readFile('database/handoff-audit.sql','utf8'));
    console.log(`${mode}: migrations, replay, retained evidence, audit reports and co-tenant preservation passed`);
  }finally{
    await db.end();await admin.query(`drop database ${name}`);
  }
}
await admin.end();

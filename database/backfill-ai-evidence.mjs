import pg from 'pg';
import {pathToFileURL} from 'node:url';

/** Commit both evidence and cursor together; interrupted pages are replayable. */
export async function backfillAiEvidence(client,{batchSize=250,maxBatches=Infinity,restart=false}={}) {
 if(!Number.isInteger(batchSize)||batchSize<1||batchSize>2000)throw Error('Batch size must be 1–2000');
 await client.query(`create table if not exists bolna_backfill_progress(name text primary key,after_id uuid,updated_at timestamptz not null default now())`);
 await client.query('revoke all on bolna_backfill_progress from public');
 let batches=0;
 for(const [table,time] of [['bolna_call_logs','processed_at'],['bolna_webhook_events','received_at']]) {
  const name='ai-evidence-v1:'+table;
  if(restart)await client.query('delete from bolna_backfill_progress where name=$1',[name]);
  for(;;) {
   if(batches>=maxBatches)return {batches,complete:false};
   try {
    await client.query('begin');
    await client.query("set local lock_timeout='2s'; set local statement_timeout='30s'");
    const page=(await client.query(`select id,raw,${time} observed from ${table}
     where id > coalesce((select after_id from bolna_backfill_progress where name=$1),'00000000-0000-0000-0000-000000000000'::uuid)
     order by id limit $2`,[name,batchSize])).rows;
    if(!page.length){await client.query('commit');break;}
    await client.query(`select bolna_record_ai_evidence(payload,'retained',observed) from jsonb_to_recordset($1::jsonb) as r(payload jsonb,observed timestamptz)`,[JSON.stringify(page.map(r=>({payload:r.raw,observed:r.observed})))]);
    await client.query(`insert into bolna_backfill_progress(name,after_id) values($1,$2)
     on conflict(name) do update set after_id=excluded.after_id,updated_at=now()`,[name,page.at(-1).id]);
    await client.query('commit');batches++;
    console.log(`Recovered ${table}: ${page.length} rows (batch ${batches})`);
   } catch(error){await client.query('rollback');throw error;}
  }
 }
 return {batches,complete:true};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
 const connection=process.env.DIRECT_URL||process.env.DATABASE_URL;
 if(!connection)throw Error('Supply DIRECT_URL or DATABASE_URL explicitly; .env.local is not loaded');
 const url=new URL(connection);for(const key of ['sslmode','pgbouncer','connection_limit'])url.searchParams.delete(key);
 const client=new pg.Client({connectionString:url.href,connectionTimeoutMillis:15000,ssl:process.env.DATABASE_SSL==='disable'?false:{rejectUnauthorized:true,...(process.env.DATABASE_SSL_CA?{ca:process.env.DATABASE_SSL_CA.replace(/\\n/g,'\n')}:{})}});
 try{await client.connect();await client.query("set lock_timeout='2s'; set statement_timeout='30s'");await client.query('select pg_advisory_lock(81620403)');console.log(await backfillAiEvidence(client,{restart:process.argv.includes('--restart')}));}
 finally{await client.end();}
}

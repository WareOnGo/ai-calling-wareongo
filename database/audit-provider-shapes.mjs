// Read-only aggregate shape inspection. Never prints payloads, contacts, or credentials.
import pg from 'pg';
import {readFileSync} from 'node:fs';
import {rootCertificates} from 'node:tls';
const connection=process.env.DIRECT_URL||process.env.DATABASE_URL;
if(!connection)throw new Error('Supply a database URL explicitly.');
const target=new URL(connection);
for(const name of ['sslmode','pgbouncer','connection_limit'])target.searchParams.delete(name);
const extraCa=readFileSync(new URL('../src/lib/database-tls.ts',import.meta.url),'utf8').match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)[0];
const ssl={rejectUnauthorized:true,ca:process.env.DATABASE_SSL_CA?.replace(/\\n/g,'\n') || [...rootCertificates,extraCa]};
const client=new pg.Client({connectionString:target.href,connectionTimeoutMillis:8000,query_timeout:12000,ssl:['localhost','127.0.0.1'].includes(target.hostname)||process.env.DATABASE_SSL==='disable'?false:ssl});
client.on('error',error=>console.error('Read-only connection error:',error.code||error.name));
try{
 await client.connect();await client.query('begin read only');await client.query("set local statement_timeout='10s'");
 const result={fixtureDatabase:['55439','55433'].includes(target.port),sampleLimitPerTable:10000,tables:{}};
 if(process.argv.includes('--legacy-only')){
  const columns=(await client.query("select table_name,column_name from information_schema.columns where table_schema='public' and table_name in ('bolna_assignments','bolna_call_logs')")).rows;
  const counts={};
  for(const table of ['bolna_assignments','bolna_call_logs']){
   const names=new Set(columns.filter(r=>r.table_name===table).map(r=>r.column_name));
   if(!names.has('wh_id')){counts[table]={warehouseColumnPresent:false};continue;}
   const nonblank="nullif(trim(wh_id),'') is not null",nonInteger=`(${nonblank} and not (trim(wh_id) ~ '^[1-9][0-9]*$' and length(trim(wh_id))<=100))`;
   counts[table]=(await client.query(`select count(*)::text total, count(*) filter(where ${nonblank})::text with_reference,
    count(*) filter(where ${nonInteger})::text legacy_non_integer,
    ${names.has('added_to_db')?`count(*) filter(where added_to_db and ${nonInteger})::text`:'null::text'} legacy_onboarded,
    ${names.has('state')?`count(*) filter(where state='done' and ${nonInteger})::text`:'null::text'} legacy_done
    from ${table}`)).rows[0];
  }
  await client.query('rollback');console.log(JSON.stringify({readOnly:true,legacyReferences:counts},null,2));
 }else{
 result.schemaHistory = (await client.query("select to_regclass('public.bolna_schema_migrations') name")).rows[0].name
  ? (await client.query('select name from bolna_schema_migrations order by name')).rows.map(r=>r.name) : [];
 result.estimatedRows = (await client.query("select relname,reltuples::bigint estimated_rows from pg_class where relname in ('bolna_call_logs','bolna_webhook_events','bolna_assignments','raw_records') and relnamespace='public'::regnamespace")).rows;
 for(const table of ['bolna_call_logs','bolna_webhook_events']){
  const rows=await client.query(`with sample as(select raw from ${table} where raw is not null limit 10000)
   select count(*)::int sampled,jsonb_typeof(raw->'conversation_duration') duration_type,
    jsonb_typeof(raw#>'{batch_run_details,retried}') retry_type,
    case when raw->>'initiated_at' is null then 'absent' when raw->>'initiated_at' ~ '(Z|[+-][0-9]{2}:?[0-9]{2})$' then 'zoned' else 'unqualified' end dial_time_shape
   from sample group by 2,3,4 order by 2,3,4`);
  result.tables[table]=rows.rows;
 }
 await client.query('rollback');console.log(JSON.stringify(result,null,2));
 }
}catch(error){console.error('Read-only provider shape audit failed:',error.code||error.name);process.exitCode=1;}
finally{await client.end();}

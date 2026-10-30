import {readFile} from 'node:fs/promises';
import pg from 'pg';

// Explicit environment, dry run by default. Never print credentials or raw errors.
const connection=process.env.DIRECT_URL||process.env.DATABASE_URL;
if(!connection||!process.env.PROCESS_SECRET)throw new Error('Supply DATABASE_URL (or DIRECT_URL) and PROCESS_SECRET explicitly');
if(process.argv.slice(2).some(arg=>!['--apply','--enable'].includes(arg)))throw new Error('Usage: node database/schedule-warehouse-sync.mjs [--apply] [--enable]');
const url=new URL(connection);
for(const key of [...url.searchParams.keys()])if(key.startsWith('ssl')||['pgbouncer','connection_limit'].includes(key))url.searchParams.delete(key);
const client=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:15000,
  ssl:process.env.DATABASE_SSL==='disable'?false:{rejectUnauthorized:true,
    ...(process.env.DATABASE_SSL_CA?{ca:process.env.DATABASE_SSL_CA.replace(/\\n/g,'\n')}:{})}});
try {
  // Inspect the deployed worker without running it or leaking the credential into a URL.
  const response=await fetch('https://ai-calling-wareongo.vercel.app/api/warehouses/sync',{
    headers:{Authorization:`Bearer ${process.env.PROCESS_SECRET}`},redirect:'error',signal:AbortSignal.timeout(15000),
  });
  const status=await response.json();
  if(!response.ok||typeof status.state?.enabled!=='boolean'||typeof status.state?.initialized!=='boolean'
    ||!Number.isInteger(status.state?.warehouse_cursor))throw new Error('Cursor-based worker status endpoint unavailable');
  await client.connect();
  await client.query("begin; set local lock_timeout='2s'; set local statement_timeout='15s'");
  const credentials=await client.query("select decrypted_secret=$1 matches from vault.decrypted_secrets where name='process_secret'",[process.env.PROCESS_SECRET]);
  if(credentials.rowCount!==1||credentials.rows[0].matches!==true)throw new Error('Vault process_secret must match the deployed PROCESS_SECRET');
  const before=(await client.query("select jobid,schedule,active from cron.job where jobname='enrich-analysis'")).rows;
  await client.query(await readFile(new URL('./schedule-warehouse-sync.sql',import.meta.url),'utf8'));
  const after=(await client.query("select jobid,schedule,active from cron.job where jobname='enrich-analysis'")).rows;
  if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Cron identity or cadence changed');
  if(process.argv.includes('--enable')) {
    if(!after[0]?.active)throw new Error('Existing enrichment cron is inactive');
    await client.query('update bolna_warehouse_sync_state set enabled=true,next_attempt_at=clock_timestamp() where id=1');
  }
  await client.query(process.argv.includes('--apply')?'commit':'rollback');
  console.log(JSON.stringify({applied:process.argv.includes('--apply'),enableRequested:process.argv.includes('--enable'),job:after[0]}));
} catch {
  await client.query('rollback').catch(()=>{});
  console.error('Warehouse scheduler installation failed; no changes committed. Check worker deployment, credentials, migration and existing cron command.');
  process.exitCode=1;
} finally {await client.end().catch(()=>{});}

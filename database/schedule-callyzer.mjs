import {readFile} from 'node:fs/promises';
import pg from 'pg';

// Explicit environment, reviewed SQL, rollback by default. No credentials in cron text.
const connection=process.env.DIRECT_URL||process.env.DATABASE_URL;
if(!connection||!process.env.PROCESS_SECRET)throw new Error('Supply DATABASE_URL (or DIRECT_URL) and PROCESS_SECRET explicitly');
if(process.argv.slice(2).some(arg=>arg!=='--apply'))throw new Error('Usage: node database/schedule-callyzer.mjs [--apply]');
const url=new URL(connection);
for(const key of ['sslmode','pgbouncer','connection_limit'])url.searchParams.delete(key);
const client=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:15000,
  ssl:process.env.DATABASE_SSL==='disable'?false:{rejectUnauthorized:true,
    ...(process.env.DATABASE_SSL_CA?{ca:process.env.DATABASE_SSL_CA.replace(/\\n/g,'\n')}:{})}});
await client.connect();
try {
  await client.query('begin');
  await client.query("set local lock_timeout='2s'; set local statement_timeout='15s'");
  const credentials=await client.query("select decrypted_secret=$1 matches from vault.decrypted_secrets where name='process_secret'",[process.env.PROCESS_SECRET]);
  if(credentials.rowCount!==1||credentials.rows[0].matches!==true)throw new Error('Vault process_secret must match the deployed PROCESS_SECRET');
  await client.query(await readFile(new URL('./schedule-callyzer.sql',import.meta.url),'utf8'));
  const jobs=await client.query("select jobname,schedule,active,command from cron.job where jobname='sync-callyzer'");
  if(jobs.rowCount!==1||!jobs.rows[0].active)throw new Error('Expected exactly one active sync-callyzer job');
  await client.query(process.argv.includes('--apply')?'commit':'rollback');
  console.log(JSON.stringify({applied:process.argv.includes('--apply'),job:jobs.rows[0],endpoint:'https://ai-calling-wareongo.vercel.app/api/callyzer/sync',timeoutSeconds:55}));
} catch(error) { await client.query('rollback');throw error; }
finally {await client.end();}

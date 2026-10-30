import pg from 'pg';
import { rootCertificates } from 'node:tls';
import { backfillWarehouseContacts } from './warehouse-contact-backfill.mjs';
import { repairWarehouseContactParsing } from './repair-warehouse-contact-parsing.mjs';

const args = new Set(process.argv.slice(2));
if ([...args].some(arg => !['--apply', '--repair-phone-parsing'].includes(arg)))
  throw new Error('Usage: node database/backfill-warehouse-contacts.mjs [--repair-phone-parsing] [--apply]');

// Explicit connections only; never load a repo's environment implicitly.
function connection(value) {
  if (!value) throw new Error('Set DIRECT_URL (or DATABASE_URL) and WAREHOUSE_DATABASE_URL explicitly');
  const url = new URL(value);
  for (const key of ['sslmode','pgbouncer','connection_limit']) url.searchParams.delete(key);
  const ca = process.env.DATABASE_SSL_CA?.replace(/\\n/g,'\n');
  return new pg.Client({ connectionString:url.href,connectionTimeoutMillis:15000,
    ssl:process.env.DATABASE_SSL==='disable'?false:{rejectUnauthorized:true,...(ca?{ca:[...rootCertificates,ca]}:{})} });
}
const caller=connection(process.env.DIRECT_URL||process.env.DATABASE_URL);
const source=connection(process.env.WAREHOUSE_DATABASE_URL);
try {
  await source.connect();
  await source.query('begin isolation level repeatable read read only');
  const snapshotAt=(await source.query('select now()::text at')).rows[0].at;
  const warehouses=(await source.query('select id,"contactNumber",alt_phone_number from "Warehouse" order by id')).rows;
  await source.query('rollback');
  await caller.connect();
  await caller.query('begin');
  await caller.query("set local lock_timeout='5s'; set local statement_timeout='60s'");
  const run=args.has('--repair-phone-parsing')?repairWarehouseContactParsing:backfillWarehouseContacts;
  const summary=await run(caller,warehouses,snapshotAt);
  await caller.query(args.has('--apply')?'commit':'rollback');
  console.log(JSON.stringify({applied:args.has('--apply'),...summary},null,2));
} catch(error) {
  await caller.query('rollback').catch(()=>{});
  // Never emit database URLs or full pg error objects containing credentials.
  console.error(JSON.stringify({code:error.code,message:error.message?.replace(/postgres(?:ql)?:\/\/\S+/g,'[database URL]')}));
  process.exitCode=1;
} finally { await Promise.all([caller.end(),source.end()]); }

// Bounded, read-only application reader profiling. Never loads a test seed.
// node --env-file=<preview env> tests/performance/profile-readers.mjs <admin email> <label>
import { createServer } from 'vite';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const [email, label, option] = process.argv.slice(2);
if (!email?.includes('@') || !/^[a-z0-9-]+$/.test(label || '') || !process.env.DATABASE_URL) throw new Error('Supply environment, authorized admin email and report label.');
const root = fileURLToPath(new URL('../../', import.meta.url));
const vite = await createServer({ root, configFile: false, logLevel: 'error', server: { middlewareMode: true }, appType: 'custom', resolve: { alias: { '@': `${root}src` } } });
const report = { label, readOnly: true, measurements: {} };
let pool, client;
try {
  const db = await vite.ssrLoadModule('/src/lib/db.ts'); pool = db.getPool();
  // Transaction poolers can ignore startup/session defaults. Pin one explicit
  // read-only transaction; these are SQL/payload measurements, not concurrency timings.
  client = await pool.connect(); await client.query('begin read only');
  await client.query("set local statement_timeout='15s'");
  if ((await client.query('show transaction_read_only')).rows[0].transaction_read_only !== 'on') throw new Error('Read-only enforcement missing');
  report.settings = (await client.query("select current_setting('jit') jit, current_setting('TimeZone') timezone")).rows[0];
  const user = (await client.query('select email,role from bolna_app_users where email=$1 and active', [email])).rows[0];
  if (user?.role !== 'admin') throw new Error('Active admin access required');
  const viewer = { email, isAdmin: true, name: null };
  const original = client.query.bind(client); let queries = [], readerName = '';
  const plans = new Map();
  pool.query = async (...args) => {
    const start = performance.now(), result = await original(...args);
    const sql = typeof args[0] === 'string' ? args[0] : args[0].text;
    const fingerprint = createHash('sha256').update(sql).digest('hex').slice(0, 12);
    queries.push({ fingerprint, ms: Math.round(performance.now() - start), rows: result.rowCount, bytes: Buffer.byteLength(JSON.stringify(result.rows)) });
    if (option === '--plans' && ['raw', 'calls', 'assignments'].includes(readerName) && !plans.has(fingerprint)) plans.set(fingerprint, { name: readerName, sql, params: args[1] });
    return result;
  };
  const raw = await vite.ssrLoadModule('/src/lib/raw.ts'), calls = await vite.ssrLoadModule('/src/lib/calls.ts');
  const assignments = await vite.ssrLoadModule('/src/lib/assignments.ts'), work = await vite.ssrLoadModule('/src/lib/personal-work.ts');
  const ai = await vite.ssrLoadModule('/src/lib/ai-attempts.ts');
  let recordId, callId;
  const readers = {
    raw: async () => { const result = await raw.getRawRecords(viewer, {}); recordId = result.rows[0]?.id; return result; },
    calls: async () => { const result = await calls.getCalls(viewer, {}); callId = result.rows[0]?.id; return result; },
    assignments: () => assignments.listAssignments(viewer, {}),
    my_work: () => work.personalWork(viewer, 'record', {}, 1),
    record_details: () => raw.getRawRecordsByIds(viewer, [recordId]),
    call_details: () => calls.getCallDetailsByIds(viewer, [callId]),
    ai_history: () => ai.aiHistory(viewer, 'call', callId, { scope: 'contact' }),
  };
  for (const [name, reader] of Object.entries(readers)) {
    readerName = name;
    const runs = [];
    for (let i = 0; i < 3; i++) {
      queries = []; const start = performance.now(); const result = await reader();
      runs.push({ ms: Math.round(performance.now() - start), resultBytes: Buffer.byteLength(JSON.stringify(result)), queries: [...queries] });
    }
    report.measurements[name] = runs;
    console.log(name, runs.map(run => `${run.ms}ms/${run.queries.length}queries/${run.resultBytes}B`).join(', '));
  }
  if (plans.size) {
    report.plans = [];
    for (const [fingerprint, input] of plans) {
      const result = (await original(`explain (analyze,buffers,format json) ${input.sql}`, input.params)).rows[0]['QUERY PLAN'][0];
      const nodes = [];
      const walk = node => {
        nodes.push({ type: node['Node Type'], relation: node['Relation Name'], index: node['Index Name'], rows: node['Actual Rows'], loops: node['Actual Loops'], totalMs: node['Actual Total Time'], sharedHits: node['Shared Hit Blocks'], sharedReads: node['Shared Read Blocks'], tempReads: node['Temp Read Blocks'], tempWrites: node['Temp Written Blocks'] });
        (node.Plans || []).forEach(walk);
      };
      walk(result.Plan);
      // Omit SQL, parameters and filter expressions, which can contain contact data.
      const entry = { name: input.name, fingerprint, planningMs: result['Planning Time'], executionMs: result['Execution Time'], jitMs: result.JIT?.Timing?.Total || 0, nodes: nodes.sort((a, b) => b.totalMs * b.loops - a.totalMs * a.loops).slice(0, 8) };
      report.plans.push(entry);
      console.log('plan', input.name, fingerprint, `${entry.planningMs}ms planning/${entry.executionMs}ms execution/${entry.jitMs}ms JIT`);
    }
  }
} finally {
  writeFileSync(`/tmp/bolna-${label}.json`, JSON.stringify(report, null, 2));
  if (client) { await client.query('rollback'); client.release(); }
  if (pool) await pool.end();
  await vite.close();
}

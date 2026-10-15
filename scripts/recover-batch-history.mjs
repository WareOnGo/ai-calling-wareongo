// Run from a trusted checkout with development dependencies installed.
// Provider requests are GET-only. Default is read-only; --apply repairs saved history.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
const [id, ...flags] = process.argv.slice(2);
if (!/^[0-9a-f-]{36}$/i.test(id || '') || flags.some(f => f !== '--apply')) {
  throw new Error('Usage: node --env-file=<env> scripts/recover-batch-history.mjs <local-batch-uuid> [--apply]');
}
const root = fileURLToPath(new URL('../', import.meta.url));
const vite = await createServer({ root, configFile: false, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom',
  resolve: { alias: { '@': `${root}src` } } });
let pool;
try {
  const db = await vite.ssrLoadModule('/src/lib/db.ts'); pool = db.getPool();
  const { recoverBatchHistory } = await vite.ssrLoadModule('/src/lib/recover-batch-history.ts');
  const result = await recoverBatchHistory(id, { apply: flags.includes('--apply'), progress: p => console.log(JSON.stringify(p)) });
  console.log(JSON.stringify(result));
} catch (error) {
  // Validation errors can contain provider field values; do not print payloads.
  console.error(error?.name === 'ZodError' ? 'Provider snapshot validation failed; recovery stopped.' : error.message);
  process.exitCode = 1;
} finally {
  if (pool) await pool.end();
  await vite.close();
}

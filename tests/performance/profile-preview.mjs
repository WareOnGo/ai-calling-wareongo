// Read-only browser timings against an already running local preview.
// Supply the preview's environment with node --env-file and an authorized email.
// No cookies, response bodies, contact identifiers or credentials enter the report.
import { createHmac } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { chromium } from '../browser/node_modules/playwright/index.mjs';

const [email, label = 'preview', port = '3000'] = process.argv.slice(2);
if (!email?.includes('@') || !process.env.SESSION_SECRET || !/^\d+$/.test(port) || !/^[a-z0-9-]+$/.test(label)) {
  throw new Error('Supply an authorized email, a report label, a local port, and the preview environment.');
}
const origin = `http://localhost:${port}`, now = Math.floor(Date.now() / 1000);
const payload = Buffer.from(JSON.stringify({ v: 1, email, iat: now, exp: now + 3600 })).toString('base64url');
const signature = createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('base64url');
const browser = await chromium.launch({ executablePath: process.env.EVAL_CHROMIUM_PATH || '/usr/bin/google-chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
await context.addCookies([{ name: 'bp_session', value: `${payload}.${signature}`, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
// Batch pages normally reconcile with the provider. Profiling must not do writes.
await context.route('**/*', route => ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort());
const page = await context.newPage(), report = { label, mode: 'read-only local preview', pages: {}, details: {} };
const ready = () => page.waitForFunction(() => {
  const content = document.querySelector('.dashboard-content');
  return content?.getAttribute('data-hydrated') === 'true' && !document.querySelector('[data-loading-view], [hidden][id^="S:"]');
}, undefined, { timeout: 120000 });
try {
  for (const name of ['raw', 'calls', 'assignments', 'my', 'batches', 'team', 'team/access']) {
    const runs = [];
    for (let i = 0; i < 3; i++) {
      const requests = [];
      const observe = request => { if (['document', 'fetch', 'xhr'].includes(request.resourceType())) requests.push({ path: new URL(request.url()).pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '[id]'), method: request.method(), prefetch: request.headers()['next-router-prefetch'] === '1' }); };
      page.on('request', observe);
      const start = performance.now(), response = await page.goto(`${origin}/dashboard/${name}`, { timeout: 120000 });
      if (!page.url().includes(`/dashboard/${name}`)) throw new Error(`Access unavailable for ${name}`);
      await ready();
      const readyMs = Math.round(performance.now() - start);
      const documentBytes = (await response.body()).length;
      const transferBytes = await page.evaluate(() => performance.getEntriesByType('navigation')[0]?.transferSize || 0);
      page.off('request', observe);
      runs.push({ readyMs, documentBytes, transferBytes, status: response.status(), requests });
    }
    report.pages[name] = runs;
    console.log(name, runs.map(run => `${run.readyMs}ms/${run.documentBytes}B`).join(', '));
  }
  for (const entity of ['raw', 'calls']) {
    await page.goto(`${origin}/dashboard/${entity}`); await ready();
    const trigger = page.locator('.contact-card .details-trigger').first();
    const responsePending = page.waitForResponse(response => /\/api\/details\/(record|call)\/[^/?]+\?/.test(response.url()));
    const start = performance.now(); await trigger.click();
    const response = await responsePending;
    await page.getByRole('tab', { name: 'AI activity', exact: true }).waitFor();
    const overviewMs = Math.round(performance.now() - start), overviewBytes = (await response.body()).length;
    const aiStart = performance.now();
    const aiResponse = page.waitForResponse(response => /\/api\/details\/.+\/ai\?/.test(response.url()));
    await page.getByRole('tab', { name: 'AI activity', exact: true }).click();
    const ai = await aiResponse; await ai.finished();
    report.details[entity] = { overviewMs, overviewBytes, aiMs: Math.round(performance.now() - aiStart), aiBytes: (await ai.body()).length };
    console.log(`${entity} details`, JSON.stringify(report.details[entity]));
    await page.keyboard.press('Escape');
  }
} finally {
  writeFileSync(`/tmp/bolna-${label}.json`, JSON.stringify(report, null, 2));
  await browser.close();
}

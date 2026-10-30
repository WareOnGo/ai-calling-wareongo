// Deferred with the unshipped employee overhaul; see README.md.
import {test,expect,type Page} from '@playwright/test';
import pg from 'pg';
import {readFileSync} from 'node:fs';
import {ADMIN,EMPLOYEE,DB_URL,PORT} from '../lib/env.mjs';
import {sessionCookie} from '../lib/session.mjs';

// Use the guarded local DB URL directly so these checks also run without a container runtime.
test.use({actionTimeout:10000});
const pool=new pg.Pool({connectionString:DB_URL,ssl:false});
test.beforeEach(async()=>{await pool.query(readFileSync(new URL('../scripts/seed.sql',import.meta.url),'utf8'));});
test.afterAll(async()=>{await pool.end();});
async function login(page:Page,email=ADMIN.email) {
  await page.context().addCookies([sessionCookie(email,PORT) as never]);
  await page.route('**/api/balance*',route=>route.fulfill({json:{balance:42,unit:'USD',state:'fresh',refreshedAt:new Date().toISOString(),low:false,message:null}}));
}
async function ready(page:Page) {
  await expect(page.locator('.dashboard-content')).toHaveAttribute('data-hydrated','true');
  await expect(page.locator('.dashboard-content')).toHaveAttribute('aria-busy','false');
  await expect(page.locator('[data-loading-view]')).toHaveCount(0);
  await expect(page.locator('[hidden][id^="S:"]')).toHaveCount(0);
}
async function panel(page:Page) {
  await page.getByRole('button',{name:'Toggle filters',exact:true}).click();
  return page.getByRole('dialog',{name:'Filters',exact:true});
}
async function mismatches(page:Page) {
  const filters=await panel(page);
  await filters.getByRole('tab',{name:'Results',exact:true}).click();
  await filters.getByLabel('AI–human comparison',{exact:true}).selectOption('mismatch');
  await filters.getByRole('button',{name:'Apply',exact:true}).click();await ready(page);
}

test('callers can log the new manual tags and filter their work by state',async({page})=>{
  await login(page,EMPLOYEE.email);await page.goto('/dashboard/my');await ready(page);
  const filters=await panel(page);await filters.getByLabel('Filter by state').fill('Gujarat');
  await filters.getByRole('button',{name:'Apply',exact:true}).click();await ready(page);
  const row=page.locator('section[data-entity="record"] tbody tr').filter({hasText:'Raghav Sharma'});
  await row.getByRole('button',{name:'Log manual call'}).click();
  const dialog=page.getByRole('dialog',{name:'Log manual call',exact:true});
  const choices=await dialog.getByLabel('What happened?').locator('option').allTextContents();
  expect(choices).toEqual(expect.arrayContaining(['Owner unresponsive','Leased out','No property for rent']));
  await dialog.getByLabel('What happened?').selectOption('leased_out');await dialog.getByRole('combobox',{name:'Manual result',exact:true}).selectOption('Unavailable');
  await dialog.getByRole('button',{name:'Record attempt',exact:true}).click();await expect(dialog).toHaveCount(0);await ready(page);
  await expect(row).toContainText('Leased out');
  const forbidden=await page.request.post('/api/assignments/bulk',{data:{action:'unassign',ids:['1']}});expect(forbidden.status()).toBe(403);
});

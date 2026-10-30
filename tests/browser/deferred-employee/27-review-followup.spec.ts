// Deferred with the unshipped employee overhaul; see README.md.
import {test,expect,bodyOverflowsX} from "../tests/fixtures";
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {CONTAINER} from '../lib/env.mjs';
const raw='a0000000-0000-4000-8000-000000000001',call='c0000000-0000-4000-8000-000000000001';
const sql=(s:string)=>execFileSync('podman',['exec','-i',CONTAINER,'psql','-U','postgres','-q','-v','ON_ERROR_STOP=1'],{input:s});
const work=(page:any,name='Raghav')=>page.locator('[data-entity="record"] tbody tr').filter({hasText:name});
const saved=async(row:any)=>expect(row.locator('.save-status')).toHaveText('Saved');
const detailShot=(locator:any,name:string)=>locator.screenshot({path:join(process.cwd(),'shots',`${name}.png`),animations:'disabled'});

test('a caller deliberately closes repeated no-answer work as Exhausted with a reason',async({employeePage:page,adminPage,shot})=>{
 await page.goto('/dashboard/my');let row=work(page);
 await row.getByRole('button',{name:'Log manual call'}).click();const dialog=page.getByRole('dialog');
 await dialog.getByLabel('What happened?').selectOption('no_answer');await dialog.getByLabel('Attempt notes',{exact:true}).fill('No response on the latest follow-up');
 await shot(page,'review2-manual-attempt');await detailShot(dialog,'changelog-manual-dialog');await dialog.getByRole('button',{name:'Record attempt'}).click();await expect(dialog).toHaveCount(0);
 await expect(row).toContainText('No answer / RNR');
 await row.getByLabel('Your notes').fill('Repeated attempts across several days received no response; follow-ups exhausted');await row.getByLabel('Your notes').blur();await saved(row);
 await row.getByLabel('Closure reason').selectOption('exhausted');await saved(row);
 await row.getByRole('button',{name:'Mark done'}).click();await saved(row);await page.reload();row=work(page);
 await expect(row.getByRole('button',{name:'Done',exact:true})).toHaveAttribute('aria-pressed','true');await expect(row.getByLabel('Closure reason')).toHaveValue('exhausted');await expect(row.getByLabel('Result of the call').locator('option:checked')).toHaveText('No manual result');
 await shot(page,'review2-exhausted-work');
 await adminPage.goto('/dashboard/assignments?state=done');const assigned=adminPage.locator('tbody tr').filter({hasText:'Raghav'});await expect(assigned).toContainText('Exhausted');await expect(assigned).toContainText('No answer / RNR');await shot(adminPage,'review2-exhausted-admin');
});

test('Keep existing result preserves a dropdown edit after an earlier call result',async({employeePage:page})=>{
 await page.goto('/dashboard/my');const row=work(page);
 let refreshes=0;await page.route('**/dashboard/my?*',async route=>{if(route.request().headers()['rsc']==='1'){refreshes++;await new Promise(resolve=>setTimeout(resolve,400));}await route.continue();});
 await row.getByRole('button',{name:'Log manual call'}).click();let dialog=page.getByRole('dialog');
 await dialog.getByRole('combobox',{name:'Manual result',exact:true}).selectOption('Unavailable');await dialog.getByRole('button',{name:'Record attempt'}).click();await expect(dialog).toHaveCount(0);
 await row.getByLabel('Result of the call').selectOption('Available');await saved(row);
 await row.getByRole('button',{name:'Log manual call'}).click();dialog=page.getByRole('dialog');await expect(dialog.getByRole('combobox',{name:'Manual result',exact:true})).toHaveValue('');
 await dialog.getByRole('button',{name:'Record attempt'}).click();await expect(dialog).toHaveCount(0);await page.reload();await expect(work(page).getByLabel('Result of the call')).toHaveValue('Available');expect(refreshes).toBeGreaterThan(0);
});

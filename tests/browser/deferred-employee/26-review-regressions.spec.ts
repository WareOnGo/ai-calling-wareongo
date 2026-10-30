// Deferred with the unshipped employee overhaul; see README.md.
import {test,expect} from "../tests/fixtures";
import {execFileSync} from 'node:child_process';
import {CONTAINER} from '../lib/env.mjs';
const sql=(s:string)=>execFileSync('podman',['exec','-i',CONTAINER,'psql','-U','postgres','-q','-v','ON_ERROR_STOP=1'],{input:s});
test('old Result and RNR notes cannot close a task without a logged call',async({employeePage:page})=>{
 await page.goto('/dashboard/my');const row=page.locator('[data-entity="record"] tbody tr').filter({hasText:'Raghav'});
 await row.getByLabel('Result of the call').selectOption('Unavailable');await expect(row.locator('.save-status')).toHaveText('Saved');
 await row.getByLabel('Your notes').fill('RNR; call back later');await row.getByLabel('Your notes').blur();await expect(row.locator('.save-status')).toHaveText('Saved');
 await row.getByRole('button',{name:'Mark done'}).click();await expect(row).toContainText('Log an actual manual call');await expect(row.getByRole('button',{name:'Mark done'})).toHaveAttribute('aria-pressed','false');
});

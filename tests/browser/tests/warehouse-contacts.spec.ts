import { test, expect } from '@playwright/test';
import pg from 'pg';
import { ADMIN, EMPLOYEE, DB_URL } from '../lib/env.mjs';
import { sessionCookie } from '../lib/session.mjs';
import { backfillWarehouseContacts } from '../../../database/warehouse-contact-backfill.mjs';
import { unreadableText } from '../lib/visual-audit';

const registered='fe000000-0000-4000-8000-000000000001';
const fresh='fe000000-0000-4000-8000-000000000002';
const callId='fe000000-0000-4000-8000-000000000003';
let aiBatchId:string;
const db=new pg.Client({connectionString:DB_URL});
test.beforeAll(async()=>{
  await db.connect();
  await db.query('truncate bolna_warehouse_imports,bolna_assignments,bolna_app_users,bolna_call_logs,raw_records,raw_phone_numbers,call_batches,bolna_dispatch_requests restart identity cascade');
  await db.query("insert into bolna_app_users(email,name,role) values($1,'Admin','admin'),($2,'Caller','employee')",[ADMIN.email,EMPLOYEE.email]);
  for(const [id,phone,name] of [[registered,'9876543210','Already Added Owner'],[fresh,'9888888888','Fresh Owner']]){
    await db.query("insert into raw_records(id,source,source_record_id,owner_name,city,state) values($1::uuid,'fixture',$1::text,$2,'Delhi','Delhi')",[id,name]);
    const p=(await db.query('insert into raw_phone_numbers(phone_last10,phone) values($1,$2) returning phone_id',[phone,`+91${phone}`])).rows[0];
    await db.query('insert into raw_phones(master_id,phone_id,is_primary) values($1,$2,true)',[id,p.phone_id]);
  }
  await db.query("insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,remarks) values('record',$1,$2,$3,'Existing caller note')",[registered,EMPLOYEE.email,ADMIN.email]);
  aiBatchId=(await db.query("insert into call_batches(state,bolna_batch_id,created_by) values('completed','warehouse-browser',$1) returning id",[ADMIN.email])).rows[0].id;
  await db.query("insert into call_batch_items(batch_id,record_id,name,contact_number) values($1,$2,'Already Added Owner','+919876543210')",[aiBatchId,registered]);
  await db.query("insert into bolna_call_logs(id,status,call_type,to_number,batch_id) values($1,'completed','outbound','+919876543210','warehouse-browser')",[callId]);
  await db.query('begin');
  await backfillWarehouseContacts(db,[{id:501,contactNumber:'09876543210'},{id:502,alt_phone_number:'+91 (98765) 43210'}],'2026-10-29T00:00:00Z');
  await db.query('commit');
});
test.afterAll(async()=>{await db.query('truncate bolna_warehouse_imports cascade');await db.end();});
test.beforeEach(async({context})=>{
  await context.addCookies([sessionCookie(ADMIN.email) as never]);
  await context.route('**/api/balance*',route=>route.fulfill({json:{balance:42,unit:'USD',state:'fresh',low:false,refreshedAt:new Date().toISOString()}}));
  await context.route('**/api/batches/sync',route=>route.fulfill({json:{checked:0,completed:0,failed:0}}));
});

for(const width of [1366,390,320])test(`warehouse warnings exclude caller and AI allocations at ${width}px`,async({page},info)=>{
  await page.setViewportSize({width,height:width===390?844:900});
  if(width===390)await page.addInitScript(()=>localStorage.setItem('theme','dark'));
  await page.goto('/dashboard/raw');
  await expect(page.locator('.dashboard-content')).toHaveAttribute('data-hydrated','true');
  await expect(page.getByText('Warehouse already added to DB',{exact:false}).first()).toBeVisible();
  await expect(page.getByText('WH 501, 502',{exact:true}).first()).toBeVisible();
  await page.locator(`.rowsel[data-id="${registered}"]`).check();
  await page.locator(`.rowsel[data-id="${fresh}"]`).check();
  await page.getByRole('button',{name:'Assign',exact:true}).click();
  const manual=page.getByRole('dialog');
  await expect(manual.locator('.allocation-summary')).toContainText('1 eligible');
  await expect(manual.locator('.warn[role="status"]')).toContainText('Numbers with warehouses already added to DB: 1');
  await manual.locator('.allocation-inspection > summary').click();
  await expect(manual.getByText('WH 501, 502',{exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath(`warehouse-manual-${width}.png`),fullPage:true});
  await manual.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:/^Queue for calling/}).click();
  const ai=page.getByRole('dialog',{name:'Queue for calling',exact:true});
  await expect(ai.getByRole('heading',{name:'1 ready to call',exact:true})).toBeVisible();
  await expect(ai.locator('.warn[role="status"]')).toContainText('Numbers with warehouses already added to DB');
  await ai.locator('.queue-contacts > summary').click();
  await expect(ai.getByText('WH 501, 502',{exact:true})).toBeVisible();
  await expect(ai.getByRole('button',{name:'Send to Bolna (1)',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.body.scrollWidth<=innerWidth)).toBe(true);
  expect(await unreadableText(page)).toEqual([]);
  await page.screenshot({path:info.outputPath(`warehouse-ai-${width}.png`),fullPage:true});
});

test('filters and CSVs retain every matched WHID across raw records, calls and both batch types',async({page})=>{
  for(const [url,idsHeader] of [
    ['/api/raw/export?warehouse_match=yes','Matched warehouse IDs'],
    ['/api/calls/export?warehouse_match=yes','Matched warehouse IDs'],
    ['/api/batches/legacy/export?kind=manual&warehouse_match=yes','warehouse_ids'],
    [`/api/batches/${aiBatchId}/export?kind=ai&warehouse_match=yes`,'warehouse_ids'],
  ]){
    const response=await page.request.get(url);expect(response.status(),url).toBe(200);
    expect(response.headers()['x-export-row-count'],url).toBe('1');
    const csv=await response.text();
    expect(csv.split('\r\n')[0],url).toContain(idsHeader);
    expect(csv,url).toContain('501; 502');
  }
  const empty=await page.request.get('/api/raw/export?warehouse_match=yes&wh_id=404');
  expect(empty.headers()['x-export-row-count']).toBe('0');
  await page.goto('/dashboard/raw');
  await page.getByRole('button',{name:'Toggle filters',exact:true}).click();
  await page.getByRole('tab',{name:'Reporting',exact:true}).click();
  await page.getByRole('combobox',{name:'Warehouse DB match',exact:true}).selectOption('yes');
  await page.getByRole('dialog').getByRole('button',{name:'Apply',exact:true}).click();
  await expect(page.locator('.rowsel')).toHaveCount(1);
  await expect(page.locator(`.rowsel[data-id="${registered}"]`)).toBeVisible();
  await expect(page.getByRole('button',{name:/Remove Warehouse DB match/})).toBeVisible();
  await page.goto(`/dashboard/batches/ai/${aiBatchId}?warehouse_match=yes`);
  await expect(page.getByText('WH 501, 502',{exact:true})).toBeVisible();
});

test('existing employee work keeps its notes and its saved warehouse field',async({context,page})=>{
  await context.addCookies([sessionCookie(EMPLOYEE.email) as never]);
  await page.goto('/dashboard/my');
  await expect(page.getByRole('textbox',{name:'Warehouse ID',exact:true})).toBeVisible();
  await expect(page.locator('#employee-work')).not.toContainText('DB matches:');
  await expect(page.getByRole('textbox',{name:'Your notes',exact:true})).toHaveValue('Existing caller note');
});

for(const [width,theme] of [[1366,'light'],[1366,'dark'],[390,'light'],[390,'dark']] as const)
test(`matched IDs occupy the existing WH ID column at ${width}px in ${theme}`,async({context,page},info)=>{
  await page.setViewportSize({width,height:900});
  await page.addInitScript(theme=>localStorage.setItem('theme',theme),theme);
  // Keep one preserved, different saved reference to distinguish it from the
  // two phone matches. Restore it so every scenario begins with the same data.
  await db.query("update bolna_assignments set wh_id='999' where entity_id=$1",[registered]);
  try{
    await page.goto('/dashboard/assignments');
    await expect(page.locator('.dashboard-content')).toHaveAttribute('data-hydrated','true');
    await page.locator('.column-menu > summary').filter({hasText:/^Columns$/}).click();
    await page.locator('.column-options').getByRole('checkbox',{name:'WH ID',exact:true}).check();
    await page.locator('.column-menu > summary').filter({hasText:/^Columns$/}).click();
    const assignment=page.locator('.warehouse-reference');
    await expect(assignment).toHaveCount(1);
    await expect(assignment).toContainText('Saved: 999');
    await expect(assignment).toContainText('DB matches: 501, 502');
    // The annotation must actually be in the WH ID cell, including on mobile.
    const column=await page.locator('th[data-column="WH ID"]').evaluate(th=>(th as HTMLTableCellElement).cellIndex);
    await expect(page.locator('tbody tr').first().locator('td').nth(column)).toContainText('DB matches: 501, 502');
    await assignment.scrollIntoViewIfNeeded();
    expect(await assignment.locator('..').evaluate(cell=>cell.scrollWidth<=cell.clientWidth+1)).toBe(true);
    await page.screenshot({path:info.outputPath(`warehouse-assignment-${width}-${theme}.png`),fullPage:true});

    await page.goto('/dashboard/calls');
    await expect(page.locator('.dashboard-content')).toHaveAttribute('data-hydrated','true');
    const call=page.locator('.warehouse-reference');
    await expect(call.locator('.warehouse-reference-value')).toHaveText('501, 502');
    await expect(call.locator('.warehouse-reference-source')).toHaveText('Matched in warehouse DB');
    const callColumn=await page.locator('th[data-column="WH ID"]').evaluate(th=>(th as HTMLTableCellElement).cellIndex);
    await expect(page.locator('tbody tr').first().locator('td').nth(callColumn)).toContainText('501, 502');
    await call.scrollIntoViewIfNeeded();
    expect(await call.locator('..').evaluate(cell=>cell.scrollWidth<=cell.clientWidth+1)).toBe(true);
    expect(await unreadableText(page)).toEqual([]);
    await page.screenshot({path:info.outputPath(`warehouse-calls-${width}-${theme}.png`),fullPage:true});
    if(width===1366&&theme==='light')await page.locator('table.sheet').screenshot({path:info.outputPath('warehouse-whid-column.png')});

    await context.addCookies([sessionCookie(EMPLOYEE.email) as never]);
    await page.goto('/dashboard/my');
    const field=page.getByRole('textbox',{name:'Warehouse ID',exact:true}).locator('..');
    await expect(field.getByRole('textbox',{name:'Warehouse ID',exact:true})).toHaveValue('999');
    await expect(field).not.toContainText('DB matches:');
    await expect(page.locator('.who .warehouse-reference-source')).toHaveCount(0);
    await field.scrollIntoViewIfNeeded();
    expect(await field.evaluate(cell=>cell.scrollWidth<=cell.clientWidth+1)).toBe(true);
    expect(await page.evaluate(()=>document.body.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath(`warehouse-my-work-${width}-${theme}.png`),fullPage:true});

  }finally{await db.query('update bolna_assignments set wh_id=null where entity_id=$1',[registered]);}
});

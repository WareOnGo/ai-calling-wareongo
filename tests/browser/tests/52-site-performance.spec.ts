import {test,expect} from './fixtures';
import {execFileSync} from 'node:child_process';
import {CONTAINER} from '../lib/env.mjs';
const call='c0000000-0000-4000-8000-000000000001';
const sql=(input:string)=>execFileSync('podman',['exec','-i',CONTAINER,'psql','-U','postgres','-q','-v','ON_ERROR_STOP=1'],{input,stdio:['pipe','ignore','pipe']});

test('AI activity loads while Overview is pending and fetches a transcript only when opened',async({adminPage:page})=>{
  const evidence={id:call,status:'completed',created_at:'2026-10-10T03:00:00Z',initiated_at:'2026-10-10T03:00:00Z',updated_at:'2026-10-10T03:02:00Z',transcript:'user: Transcript fetched only on demand',conversation_duration:30,telephony_data:{provider_call_id:'lazy-evidence',to_number:'+919811100001',call_type:'outbound',duration:30}};
  sql(`select bolna_record_ai_evidence('${JSON.stringify(evidence)}'::jsonb,'retained')`);
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/details/record/*?section=overview',async route=>{await held;await route.continue();});
  let transcripts=0;
  page.on('request',request=>{if(new URL(request.url()).searchParams.get('transcript')==='1')transcripts++;});
  await page.goto('/dashboard/raw?q=Raghav');
  await page.getByRole('button',{name:'Show AI attempts',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog.locator('.attempt-card')).toHaveCount(1);
  expect(transcripts).toBe(0);await expect(dialog.locator('.transcript')).toHaveCount(0);
  await dialog.locator('.attempt-transcript > summary').click();
  await expect(dialog.locator('.transcript')).toContainText('Transcript fetched only on demand');
  expect(transcripts).toBe(1);
  await dialog.locator('.attempt-transcript > summary').click();
  await dialog.locator('.attempt-transcript > summary').click();
  expect(transcripts).toBe(1);
  release();await expect(dialog.locator('.detail-contact-bar')).toBeVisible();
  await dialog.getByRole('tab',{name:'Overview',exact:true}).click();await expect(dialog).toContainText('Property');
});

test('classic employee details requests only its displayed sections',async({employeePage:page})=>{
  await page.goto('/dashboard/my');
  const response=page.waitForResponse(response=>response.url().includes('section=classic'));
  await page.getByRole('button',{name:'Details for record',exact:true}).first().click();
  const data=await(await response).json();
  expect(data.history).toBeDefined();expect(data.manual).toBeUndefined();expect(data.relatedListings).toBeUndefined();
  await expect(page.getByRole('dialog')).toContainText('Verification history');
});

test('a slow synchronization request does not block committed batch status',async({adminPage:page})=>{
  const batch='88000000-0000-4000-8000-000000000052';
  sql(`insert into call_batches(id,state,bolna_batch_id,updated_at) values('${batch}','scheduled','slow-sync',now()-interval '1 day')`);
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/batches/sync',async route=>{await held;await route.fulfill({json:{queued:true},status:202});});
  await page.clock.install();await page.goto('/dashboard/batches/ai/'+batch);
  sql(`update call_batches set state='completed',completed_at=now() where id='${batch}'`);
  await page.clock.fastForward(2500);
  await expect(page.locator('.batch-status')).toHaveText('Completed');
  release();
});

test('preview pages stay bounded and a stale cached page cannot allocate changed ownership',async({adminPage:page})=>{
  sql(`insert into raw_records(id,source,source_record_id,owner_name)
    select md5('preview-page-'||n)::uuid,'preview-pages',n::text,'Preview owner '||n from generate_series(1,61) n;
    insert into raw_phone_numbers(phone_last10,phone) select (9833000000+n)::text,(9833000000+n)::text from generate_series(1,61) n;
    insert into raw_phones(master_id,phone_id,is_primary) select r.id,p.phone_id,true from raw_records r join raw_phone_numbers p on p.phone_last10=(9833000000+r.source_record_id::int)::text where r.source='preview-pages';`);
  await page.goto('/dashboard/raw?q=Preview+owner');await page.locator('.btn-assign').click();
  const dialog=page.getByRole('dialog');await expect(dialog.getByRole('region',{name:'Assignment preview'})).toContainText('61 eligible');
  const responses:any[]=[];
  page.on('response',async response=>{if(new URL(response.url()).pathname==='/api/assignments/preview'&&response.ok())responses.push(await response.json());});
  await dialog.getByText('Inspect selected records and planned actions',{exact:true}).click();
  await dialog.getByRole('button',{name:'Next records',exact:true}).click();
  await expect(dialog.locator('.allocation-pagination')).toContainText('Page 2 of 2');
  expect(responses.at(-1).items).toHaveLength(11);expect(responses.at(-1).itemTotal).toBe(61);
  const selected=responses.at(-1).items[0].id;
  expect((await page.request.post('/api/assignments',{data:{entity_type:'record',ids:[selected],assignee:'raj@eval.test'}})).ok()).toBe(true);
  await dialog.getByRole('button',{name:'Previous records',exact:true}).click();
  await expect(dialog.locator('.allocation-pagination')).toContainText('Page 1 of 2');
  await dialog.getByRole('button',{name:'Assign 61',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('changed');
  await dialog.getByRole('button',{name:'Refresh preview',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Assign 60',exact:true})).toBeEnabled();
});

test('unchanged filtered catalog polls keep page and repeated filters without refreshing',async({adminPage:page})=>{
  sql(`insert into call_batches(id,state,created_by,created_at,agent_id)
    select md5('scoped-poll-'||n)::uuid,'completed','admin@eval.test',now()-n*interval '1 second',' scoped-agent ' from generate_series(1,27) n`);
  await page.clock.install();
  await page.goto('/dashboard/batches?kind=ai&state=completed&state=canceled&page=2&agent=%20scoped-agent%20');
  await expect(page.locator('.batch-card')).toHaveCount(2);
  let refreshes=0;
  page.on('request',request=>{if(request.headers()['rsc']==='1' && !request.headers()['next-router-prefetch'] && new URL(request.url()).pathname==='/dashboard/batches')refreshes++;});
  const response=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/batches/version');
  await page.clock.fastForward(30_500);
  const poll=await response,params=new URL(poll.url()).searchParams;
  expect(poll.status()).toBe(200);expect(params.get('page')).toBe('2');expect(params.getAll('state')).toEqual(['completed','canceled']);
  expect(params.get('agent')).toBe(' scoped-agent ');
  await expect(page.locator('.batch-live')).toHaveText('Live updates · every 30s');
  expect(refreshes).toBe(0);await expect(page.locator('.batch-card')).toHaveCount(2);
});

test('detail polling ignores unrelated edits but refreshes a visible change after rendering',async({adminPage:page})=>{
  const batch='88000000-0000-4000-8000-000000000053';
  sql(`insert into call_batches(id,state,bolna_batch_id) values('${batch}','completed','scoped-version');
    insert into call_batch_items(batch_id,record_id,name,contact_number,area) values('${batch}','a0000000-0000-4000-8000-000000000001','Visible contact','+919811100001','Rajkot')`);
  await page.clock.install();await page.goto('/dashboard/batches/ai/'+batch+'?q=Visible');
  await expect(page.locator('.batch-grid')).toContainText('Visible contact');
  let refreshes=0;
  page.on('request',request=>{if(request.headers()['rsc']==='1' && !request.headers()['next-router-prefetch'] && new URL(request.url()).pathname==='/dashboard/batches/ai/'+batch)refreshes++;});
  sql("update raw_records set owner_name='An unrelated source edit' where id='a0000000-0000-4000-8000-000000000001'");
  let response=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/batches/version');
  await page.clock.fastForward(30_500);expect((await response).status()).toBe(200);
  await expect(page.locator('.batch-live')).toHaveText('Live updates · every 30s');expect(refreshes).toBe(0);
  sql(`update call_batch_items set name='Visible updated contact' where batch_id='${batch}'`);
  response=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/batches/version');
  await page.clock.fastForward(30_500);expect((await response).status()).toBe(200);
  await expect(page.locator('.batch-grid')).toContainText('Visible updated contact');expect(refreshes).toBe(1);
});

test('the deployed request boundary rejects oversized employee mutations with bounded errors',async({employeePage:page})=>{
  const invalid=await page.request.post('/api/board/no-answer',{data:{tasks:Array(10_000).fill(null)}});
  expect(invalid.status()).toBe(400);expect((await invalid.text()).length).toBeLessThan(512);
  const oversized=await page.request.post('/api/board/no-answer',{data:{tasks:[],padding:'x'.repeat(1024*1024)}});
  expect(oversized.status()).toBe(413);expect(await oversized.json()).toEqual({error:'Request body is too large'});
});

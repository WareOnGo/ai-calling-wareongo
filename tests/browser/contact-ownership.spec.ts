import {test,expect,type Page} from "@playwright/test";
import {Pool} from "pg";
import {createHmac} from "node:crypto";
import {SESSION_SECRET} from "./playwright.config";
const db=process.env.TEST_DATABASE_URL!;
if(!db||!["127.0.0.1","localhost","[::1]"].includes(new URL(db).hostname))throw Error("Requires local fixtures");
const pool=new Pool({connectionString:db,ssl:false});
const admin="admin@contact.test",a="caller-a@contact.test",b="caller-b@contact.test";
const raw=(n:number)=>`a0000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const call=(n:number)=>`c0000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
async function signIn(page:Page,email:string){const now=Math.floor(Date.now()/1000),payload=Buffer.from(JSON.stringify({v:1,email,iat:now,exp:now+3600})).toString("base64url");await page.context().clearCookies();await page.context().addCookies([{name:"bp_session",value:payload+"."+createHmac("sha256",SESSION_SECRET).update(payload).digest("base64url"),domain:"localhost",path:"/",httpOnly:true,sameSite:"Lax"}]);}
async function visit(page:Page,path:string){expect((await page.goto(path))?.status()).toBe(200);await page.waitForLoadState("networkidle");}
async function choose(page:Page,id:string){await page.locator(`input.rowsel[data-id="${id}"]`).check();await expect(page.locator('.selection-summary')).toContainText('selected on this page');await page.getByRole("button",{name:"Assign",exact:true}).click();}
async function submit(page:Page,owner:string,reassign=false){const dialog=page.getByRole("dialog");await dialog.getByRole("combobox").selectOption(owner);if(reassign)await dialog.getByLabel("Reassign existing contacts, including linked phone numbers").check();const saved=page.waitForResponse(r=>r.request().method()==="POST"&&r.url().endsWith("/api/assignments"));await dialog.getByRole("button",{name:/^Assign \d/}).click();expect((await saved).status()).toBe(200);await expect(dialog.locator('.assign-done')).toBeVisible();return dialog;}

test.beforeEach(async({page})=>{
 await pool.query("truncate bolna_assignments,bolna_app_users,bolna_webhook_events,bolna_call_logs,raw_phones,raw_records,raw_phone_numbers,call_batch_items,call_batches,bolna_dispatch_requests restart identity cascade");
 await pool.query("insert into bolna_app_users(email,name,role) values ($1,'Test Admin','admin'),($2,'Caller A','employee'),($3,'Caller B','employee')",[admin,a,b]);
 for(let n=1;n<=3;n++){
  await pool.query("insert into raw_phone_numbers(phone_last10,phone) values ($1,$2)",["981110000"+n,"+91981110000"+n]);
  await pool.query("insert into raw_records(id,source,source_record_id,owner_name,area_sqft,city) values ($1,'browser',$2,$3,$4,'Delhi')",[raw(n),String(n),["Primary warehouse","Alternate listing","Free warehouse"][n-1],1000*n]);
 }
 await pool.query("insert into raw_phones(master_id,phone_id,is_primary) values ($1,1,true),($1,2,false),($2,2,true),($3,3,true)",[raw(1),raw(2),raw(3)]);
 for(let n=1;n<=4;n++){
  const p=n<=2?1:n-1;
  await pool.query("insert into bolna_call_logs(id,status,call_type,to_number,from_number,phone_id,context_details) values ($1,'completed',$2,$3,$4,$5,$6)",[call(n),n===3?"inbound":"outbound",n===3?"+918000000000":(n===2?"09811100001":"+91981110000"+p),n===3?"+919811100002":"+918000000000",p,JSON.stringify({recipient_data:{name:"Test call "+n}})]);
 }
 await pool.query("insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state) values ('record',$1,$2,$3,'done')",[raw(1),a,admin]);
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='localhost'?r.continue():r.abort());
 await signIn(page,admin);
});
test.afterAll(async()=>{await pool.end();});

test("Unassigned excludes completed contacts and alternate phones in both grids and CSV",async({page})=>{
 for(const [path,id] of [["raw",raw(3)],["calls",call(4)]]){
  await visit(page,`/dashboard/${path}?assignee=none`);await expect(page.locator('tbody input.rowsel')).toHaveCount(1);await expect(page.locator(`input.rowsel[data-id="${id}"]`)).toBeVisible();
  const csv=await page.request.get(`/api/${path}/export?assignee=none`);expect(csv.status()).toBe(200);expect(csv.headers()['x-export-row-count']).toBe('1');const text=await csv.text();expect(text).toContain('9811100003');expect(text).not.toContain('9811100001');expect(text).not.toContain('9811100002');
 }
 await visit(page,'/dashboard/calls');await expect(page.locator('tbody tr').filter({has:page.locator(`input[data-id="${call(2)}"]`)})).toContainText(a);
});

test("Assign dialog deduplicates repeated call numbers and reports skipped rows",async({page})=>{
 await pool.query("update bolna_assignments set state='dropped'");await visit(page,'/dashboard/calls');
 await page.getByRole('checkbox',{name:'Select all on this page'}).check();await page.getByRole('button',{name:'Assign',exact:true}).click();
 const dialog=await submit(page,a);await expect(dialog).toContainText('Assigned 3 call(s)');await expect(dialog).toContainText('1 skipped — duplicate phone numbers');
 expect((await pool.query("select count(*)::int n from bolna_assignments where state='open'")).rows[0].n).toBe(3);
});

test("Owned contacts are skipped; explicit reassign transfers linked work and keeps notes",async({page})=>{
 await pool.query("update bolna_assignments set state='open',remarks='Existing caller notes'");
 await visit(page,'/dashboard/calls');await choose(page,call(2));let dialog=await submit(page,b);await expect(dialog).toContainText('Assigned 0 call(s)');await expect(dialog).toContainText('already has assigned or completed work');
 await dialog.getByRole('button',{name:'Done',exact:true}).click();await visit(page,'/dashboard/calls');await choose(page,call(2));dialog=await submit(page,b,true);
 await expect(dialog).toContainText('Assigned 1 call(s)');await expect(dialog).toContainText('1 previous open assignments closed');
 expect((await pool.query("select state,remarks from bolna_assignments where id=1")).rows[0]).toEqual({state:'dropped',remarks:'Existing caller notes'});
 await signIn(page,a);await visit(page,'/dashboard/my');await expect(page.getByText('Nothing is assigned to you yet')).toBeVisible();
 await signIn(page,b);await visit(page,'/dashboard/my');await expect(page.locator('section[data-entity="call"] tbody tr')).toHaveCount(1);
});

test("All matching Unassigned assigns only the remaining unowned contact",async({page})=>{
 await visit(page,'/dashboard/raw?assignee=none');await page.getByRole('button',{name:'Assign',exact:true}).click();const dialog=await submit(page,b);await expect(dialog).toContainText('Assigned 1 record(s)');
 expect((await pool.query("select entity_id from bolna_assignments where state='open'")).rows).toEqual([{entity_id:raw(3)}]);
});

test("Available, WH ID, Done and navigation still work without a manual call form",async({page})=>{
 await pool.query("update bolna_assignments set state='open'");await signIn(page,a);await visit(page,'/dashboard/my');
 const row=page.locator('section[data-entity="record"] tbody tr');await expect(row).toHaveCount(1);await expect(page.getByRole('button',{name:'Log manual call'})).toHaveCount(0);
 async function save(action:()=>Promise<unknown>){const response=page.waitForResponse(r=>r.request().method()==='PATCH'&&r.url().includes('/api/assignments/'));await action();expect((await response).status()).toBe(200);await expect(page.locator('.sheet-save-status')).toContainText('All changes saved');}
 await save(()=>row.getByLabel('Result of the call').selectOption('Available'));await save(async()=>{await row.getByLabel('Warehouse ID').fill('12345');await row.getByLabel('Warehouse ID').blur();});await save(()=>row.getByRole('button',{name:'Mark done',exact:true}).click());
 await page.getByRole('link',{name:/^Open\s/}).click();await page.waitForURL('**/dashboard/my?view=open');await expect(page.getByText("You're all caught up",{exact:true})).toBeVisible();
 await visit(page,'/dashboard/my');await expect(row.getByRole('button',{name:'Done',exact:true})).toHaveAttribute('aria-pressed','true');await expect(row.getByLabel('Warehouse ID')).toHaveValue('12345');
});

test("Simultaneous real API requests cannot assign shared numbers to different callers",async({page})=>{
 await pool.query("update bolna_assignments set state='dropped'");
 const responses=await Promise.all([a,b].map((owner,i)=>page.request.post('/api/assignments',{data:{entity_type:'call',ids:[call(i+1)],assignee:owner}})));
 expect(responses.map(r=>r.status())).toEqual([200,200]);const results=await Promise.all(responses.map(r=>r.json()));expect(results.reduce((sum,r)=>sum+r.assigned,0)).toBe(1);expect(results.reduce((sum,r)=>sum+r.skippedOwned,0)).toBe(1);
});

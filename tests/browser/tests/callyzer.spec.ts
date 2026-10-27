import { test,expect,bodyOverflowsX } from "./fixtures";
import pg from "pg";
import type { Page } from "@playwright/test";
import { DB_URL } from "../lib/env.mjs";

async function showAllCallers(page: Page) {
  const more=page.getByRole("button",{name:/^Show \d+ more/});
  if(await more.count()) await more.click();
}

async function seedActivity() {
  const client = new pg.Client({connectionString:DB_URL,ssl:false});
  await client.connect();
  try {
    await client.query(`update bolna_app_users set callyzer_number='91-9876543210',callyzer_tracking_since='2026-01-01',
      callyzer_device=jsonb_build_object('checked_at',now(),'found',true,'last_sync_req_at',null) where email='priya@eval.test'`);
    const streams = Object.fromEntries(["phone","whatsapp_voice","whatsapp_video"].map(key => [key,{since:Date.parse("2026-01-01T00:00:00Z")/1000,through:Math.floor(Date.now()/1000)-60,backfilled:true}]));
    await client.query("insert into callyzer_sync_state(account_key,streams,last_attempt_at,last_success_at) values('browser-test',$1,now(),now())",[JSON.stringify(streams)]);
    await client.query(`insert into callyzer_calls(account_key,source_id,employee_number,caller_email,client_name,client_number,occurred_at,duration_seconds,call_type,call_method,call_mode,provider_synced_at)
      select 'browser-test','phone-'||g,'91-9876543210','priya@eval.test','Test contact','91-9811100001',now()-g*interval '1 minute',20,'Outgoing','PhoneCall','Voice',now()
      from generate_series(1,51) g`);
    await client.query(`insert into callyzer_calls(account_key,source_id,employee_number,caller_email,client_name,occurred_at,duration_seconds,call_type,call_method,call_mode)
      values('browser-test','whatsapp-video','91-9876543210','priya@eval.test','Video contact',now(),null,'Missed','WhatsAppCall','Video')`);
  } finally {await client.end();}
}

test("admin links an optional caller number, sees duplicate validation, and can unlink",async ({adminPage:page}) => {
  await page.goto("/dashboard/team/access");
  const priya = page.locator(".person").filter({hasText:"priya@eval.test"});
  await priya.locator("summary").click();
  await priya.getByLabel("Callyzer number for priya@eval.test").fill("+91-9876543210");
  await priya.getByLabel("Callyzer tracking date for priya@eval.test").fill("2026-01-01");
  await priya.getByRole("button",{name:"Save caller link"}).click();
  await expect(priya.locator("summary")).toHaveText("Callyzer · 91-9876543210");
  const raj = page.locator(".person").filter({hasText:"raj@eval.test"});
  await raj.locator("summary").click();
  await raj.getByLabel("Callyzer number for raj@eval.test").fill("91-9876543210");
  await raj.getByRole("button",{name:"Save caller link"}).click();
  await expect(raj.getByRole("status")).toContainText("already linked to another caller");
  await priya.locator("summary").click();
  await priya.getByRole("button",{name:"Unlink",exact:true}).click();
  await expect(priya.locator("summary")).toContainText("Manual only");
});

test("automatic activity preserves manual metrics, supports caller history and channel filters",async ({adminPage:page,shot}) => {
  await seedActivity();
  await page.goto("/dashboard/team");
  await showAllCallers(page);
  const table = page.getByRole("region",{name:"Team metrics table",exact:true});
  const row = table.getByRole("row").filter({hasText:"Priya Eval"});
  await expect(row).toContainText("Imported");
  await row.getByLabel("Coverage for priya@eval.test",{exact:true}).click();
  await expect(row).toContainText("Device update time unknown");
  await row.getByLabel("Coverage for priya@eval.test",{exact:true}).click();
  await expect(row.getByRole("cell").nth(0)).toHaveText("52");
  const manualOnly = table.getByRole("row").filter({hasText:"Raj Eval"});
  await expect(manualOnly).toContainText("Manual only");
  await expect(manualOnly.getByRole("cell").nth(0)).toHaveText("—");
  await expect(page.getByRole("region",{name:"Team metrics table",exact:true})).toBeVisible();
  await expect(table).not.toContainText("admin@eval.test");
  await expect(page.locator(".team-metric").filter({hasText:"Calls received"}).locator("strong")).toHaveText("52");
  await expect(page.getByRole("region",{name:"Manual call logs table",exact:true})).toBeHidden();
  await expect(page.getByLabel("Caller",{exact:true}).locator("option[value='admin@eval.test']")).toHaveCount(0);
  await page.getByRole("link",{name:"Call history for priya@eval.test",exact:true}).click();
  const history = page.getByRole("region",{name:"Caller call history table",exact:true});
  await expect(history.getByRole("row")).toHaveCount(51);
  await page.getByRole("navigation",{name:"Call history pages"}).getByRole("link",{name:"Next"}).click();
  await expect(history.getByRole("row")).toHaveCount(3);
  await page.locator(".team-report-filters").getByRole("button",{name:"Toggle filters"}).click();
  await page.getByRole("tab",{name:"Team",exact:true}).click();
  await page.getByLabel("Call channel",{exact:true}).selectOption("whatsapp_video");
  await page.getByRole("dialog",{name:"Filters",exact:true}).getByRole("button",{name:"Apply",exact:true}).click();
  await expect(history.getByRole("row")).toHaveCount(2);
  await expect(history).toContainText("WhatsApp · video");
  await expect(history).toContainText("Unknown");
  expect(await bodyOverflowsX(page)).toBe(false);
  await shot(page,"callyzer-activity-desktop");
  await page.setViewportSize({width:390,height:844});
  expect(await bodyOverflowsX(page)).toBe(false);
  await shot(page,"callyzer-activity-mobile");
});

test("unlinking keeps received historical counts visible without claiming current coverage",async ({adminPage:page}) => {
  await seedActivity();
  await page.goto("/dashboard/team/access");
  const person = page.locator(".person").filter({hasText:"priya@eval.test"});
  await person.locator("summary").click();
  await person.getByRole("button",{name:"Unlink",exact:true}).click();
  await expect(person.locator("summary")).toContainText("Manual only");

  await page.goto("/dashboard/team");
  await showAllCallers(page);
  const table = page.getByRole("region",{name:"Team metrics table",exact:true});
  const retained = table.getByRole("row").filter({hasText:"Priya Eval"});
  await expect(retained).toContainText("Manual only");
  await expect(retained.getByRole("cell").nth(0)).toHaveText("52");
  await expect(retained.getByRole("cell").nth(1).locator(".team-cell-value")).toHaveText("51");
  await expect(table.getByRole("row").filter({hasText:"Raj Eval"}).getByRole("cell").nth(0)).toHaveText("—");
  await page.getByRole("link",{name:"Call history for priya@eval.test",exact:true}).click();
  await expect(page.getByRole("region",{name:"Caller call history",exact:true})).toContainText("52 received calls");
});

test("partial imports and delayed sync stay explicit, and employees cannot read caller management",async ({adminPage:page,employeePage}) => {
  await seedActivity();
  await page.goto("/dashboard/team?range=all");
  await expect(page.getByRole("region",{name:"Team metrics table",exact:true})).toContainText("Partial coverage");
  const client = new pg.Client({connectionString:DB_URL,ssl:false});await client.connect();
  try {await client.query("update callyzer_sync_state set last_error='Callyzer HTTP 429'");} finally {await client.end();}
  await page.reload();
  await expect(page.getByRole("region",{name:"Team metrics table",exact:true})).toContainText("Sync delayed");
  await employeePage.goto("/dashboard/team?activity_caller=priya%40eval.test");
  await expect(employeePage).toHaveURL(/\/dashboard\/my/);
  expect((await employeePage.request.post("/api/users",{data:{email:"priya@eval.test",callyzer_number:"91-9876543210",callyzer_since:"2026-01-01"}})).status()).toBe(403);
  expect((await employeePage.request.post("/api/callyzer/sync",{data:{}})).status()).toBe(401);
});

test("bad links, disabled logging and future dates cannot look like healthy zero activity",async ({adminPage:page}) => {
  await seedActivity();
  const client = new pg.Client({connectionString:DB_URL,ssl:false});await client.connect();
  try {
    await client.query(`update bolna_app_users set callyzer_number='91-9876543211',callyzer_tracking_since='2026-01-01',
      callyzer_device=jsonb_build_object('checked_at',now(),'found',false,'last_sync_req_at',null) where email='raj@eval.test'`);
    await client.query(`update bolna_app_users set callyzer_device=callyzer_device||'{"logging_enabled":false}'::jsonb where email='priya@eval.test'`);
  } finally {await client.end();}
  await page.goto("/dashboard/team");
  await showAllCallers(page);
  const table = page.getByRole("region",{name:"Team metrics table",exact:true});
  const missing = table.getByRole("row").filter({hasText:"Raj Eval"});
  await expect(missing.locator(".callyzer-status")).toHaveText("Number not found");
  await expect(missing.getByRole("cell").nth(0)).toHaveText("—");
  const disabled = table.getByRole("row").filter({hasText:"Priya Eval"});
  await expect(disabled.locator(".callyzer-status")).toHaveText("Device logging off");
  await expect(disabled.getByRole("cell").nth(0)).toHaveText("52");
  const future = new Date(Date.now()+2*86400000).toISOString().slice(0,10);
  await page.goto(`/dashboard/team?date_from=${future}&date_to=${future}`);
  await expect(disabled.locator(".callyzer-status")).toHaveText("Future period");
  await expect(disabled.getByRole("cell").nth(0)).toHaveText("—");
});

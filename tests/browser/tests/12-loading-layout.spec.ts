import { test, expect, bodyOverflowsX } from './fixtures';
import { Client } from 'pg';
import { DB_URL } from '../lib/env.mjs';

async function rectangles(page: any, selector: string) {
  return page.locator(selector).evaluateAll((els: Element[]) => els.filter(el => el.getClientRects().length).map(el => {
    const r=el.getBoundingClientRect();return {text:el.textContent?.trim(), x:r.x,y:r.y,width:r.width,height:r.height};
  }));
}

for (const width of [1366,390]) {
  for (const view of ['calls','raw','my','assignments','team','home']) {
    test(`${view} skeleton matches its page at ${width}px`,async ({adminPage:admin,employeePage:employee})=>{
      const page=view==='my'?employee:admin;
      await page.setViewportSize({width,height:900});
      const table=view==='calls'?'bolna_call_logs':view==='raw'?'raw_records':'bolna_assignments';
      const path=view==='home'?'/dashboard':`/dashboard/${view}`;
      const db=new Client({connectionString:DB_URL,ssl:false});await db.connect();
      let before: any;
      try {
        await db.query('begin');await db.query(`lock table ${table} in access exclusive mode`);
        await page.goto(path,{waitUntil:'commit'});
        await expect(page.locator(`[data-loading-view="${view}"]`)).toHaveCount(1);
        await expect(page.locator(`[data-loading-view="${view}"]`)).toBeVisible();
        await expect(page.getByRole('status').filter({hasText:/Loading/}).first()).toBeAttached();
        expect(await bodyOverflowsX(page)).toBe(false);
        const selector=view==='home'?'.hub-card':view==='team'?'.team-report h2':'.colheads th';
        if(view==='calls'||view==='raw')await expect(page.locator('.loading-sheet col')).not.toHaveCount(0);
        before={headers:await rectangles(page,selector), title:await rectangles(page,'.page-title'),toolbar:await rectangles(page,'.filterbar'),rows:await rectangles(page,'tbody tr'),section:await rectangles(page,'.section-head'),stats:await rectangles(page,'.stat-row')};
        await page.screenshot({path:`shots/loading-${view}-${width}.png`,animations:'disabled'});
      } finally {await db.query('commit');await db.end();}
      await expect(page.locator('[data-loading-view]')).toHaveCount(0);
      await expect(page.locator('.dashboard-content')).toHaveAttribute('data-hydrated','true');
      if(view==='calls'||view==='raw')await expect(page.locator('table.sheet')).toHaveClass(/resizable/);
      const selector=view==='home'?'.hub-card':view==='team'?'.team-report h2':'.colheads th';
      const after=await rectangles(page,selector);
      if(view!=='team')expect(after.length).toBe(before.headers.length);
      for(const [index,r] of after.entries()){
        if(!before.headers[index])continue;
        const old=before.headers[index];
        if(view==='home'){
          expect(Math.abs(r.x-old.x),'card x').toBeLessThanOrEqual(1);
          expect(Math.abs(r.y-old.y),'card y').toBeLessThanOrEqual(2);
          expect(Math.abs(r.width-old.width),'card width').toBeLessThanOrEqual(1);
          expect(Math.abs(r.height-old.height),'card height').toBeLessThanOrEqual(2);
        } else if(view==='calls'||view==='raw'||view==='my'||view==='assignments'){
          expect(r.text).toBe(old.text);
          expect(Math.abs(r.x-old.x),`${r.text} x`).toBeLessThanOrEqual(1);
          expect(Math.abs(r.width-old.width),`${r.text} width`).toBeLessThanOrEqual(1);
          // Second work section depends on the unknown data row count/length.
          if(view!=='my'||index<8)expect(Math.abs(r.y-old.y),`${r.text} y`).toBeLessThanOrEqual(2);
        }
      }
      const toolbar=await rectangles(page,'.filterbar');
      if(toolbar.length){expect(Math.abs(toolbar[0].height-before.toolbar[0].height),'toolbar height').toBeLessThanOrEqual(1);expect(Math.abs(toolbar[0].y-before.toolbar[0].y),'toolbar y').toBeLessThanOrEqual(2);}
      if(view==='assignments'){
        expect(after.map(r=>r.text)).toEqual(before.headers.map((r:any)=>r.text));
        expect(Math.abs(after[0].y-before.headers[0].y)).toBeLessThanOrEqual(2);
        expect((await rectangles(page,'tbody tr'))[0].height).toBeGreaterThanOrEqual(40);
      }
      if(view==='team'){
        expect(Math.abs(after[0].x-before.headers[0].x)).toBeLessThanOrEqual(1);
        expect(Math.abs(after[0].y-before.headers[0].y)).toBeLessThanOrEqual(2);
        expect(Math.abs(after[0].height-before.headers[0].height)).toBeLessThanOrEqual(2);
      }
      await page.screenshot({path:`shots/loaded-${view}-${width}.png`,animations:'disabled'});
    });
  }
}

test('employee skeleton follows saved widths, hidden columns and expanded groups',async ({employeePage:page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/dashboard/calls');
  await page.evaluate(()=>{
    localStorage.setItem('sheet-col-widths-v6:/dashboard/calls',JSON.stringify({Owner:280,Number:200}));
    localStorage.setItem('sheet-hidden:/dashboard/calls',JSON.stringify(['When','Direction']));
    localStorage.setItem('sheet-groups:/dashboard/calls:db','true');
  });
  const db=new Client({connectionString:DB_URL,ssl:false});await db.connect();let before:any;
  try {
    await db.query('begin');await db.query('lock table bolna_call_logs in access exclusive mode');
    await page.goto('/dashboard/calls',{waitUntil:'commit'});
    await expect(page.locator('.loading-sheet')).toBeAttached();
    await expect(page.locator('.loading-sheet')).toBeVisible();
    await expect(page.locator('.loading-sheet th.db-col').first()).toBeVisible();
    expect(await page.locator('.loading-sheet .selcol').count()).toBe(0);
    before=await rectangles(page,'.colheads th');
    expect(before.find((r:any)=>r.text==='Owner').width).toBe(280);
  } finally {await db.query('commit');await db.end();}
  await expect(page.locator('[data-loading-view]')).toHaveCount(0);
  await expect(page.locator('table.sheet')).toHaveClass(/resizable/);
  const after=await rectangles(page,'.colheads th');expect(after).toEqual(before);
  expect(errors).toEqual([]);
});

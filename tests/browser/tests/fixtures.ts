import { test as base, expect, type Page, type BrowserContext } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { CONTAINER } from "../lib/env.mjs";
import { ADMIN, EMPLOYEE, EMPLOYEE2, PORT } from "../lib/env.mjs";
import { sessionCookie } from "../lib/session.mjs";

const SHOTS = join(process.cwd(), "shots");
mkdirSync(SHOTS, { recursive: true });

// A streamed document's load event can precede reveal/hydration. Ordinary tests
// interact only once handlers and grid controls exist; loading-layout tests opt
// out explicitly with waitUntil:'commit' so their blocked-DB checks stay real.
function instrumentContext(context: BrowserContext) {
  const newPage = context.newPage.bind(context);
  context.newPage = async () => {
    const page = await newPage();
    const ready = async () => {
      if (!new URL(page.url()).pathname.startsWith('/dashboard')) return;
      await page.waitForFunction(() => {
        const content = document.querySelector<HTMLElement>('.dashboard-content');
        if (!content) return true; // sign-in or an authorization redirect
        // React stages streamed markup in hidden S: containers. The live UI can
        // hydrate before their queued removal; raw locators would see duplicate
        // controls during that interval. Wait for the initial stream to settle.
        if (document.querySelector('[hidden][id^="S:"]')) return false;
        if (content.dataset.hydrated !== 'true' || document.querySelector('[data-loading-view]')) return false;
        const table = content.querySelector('table.sheet');
        return !['/dashboard/raw','/dashboard/calls','/dashboard/assignments'].includes(content.dataset.page || '') || !table || table.classList.contains('resizable');
      }, undefined, {timeout: 10000});
    };
    const goto = page.goto.bind(page), reload = page.reload.bind(page);
    page.goto = async (url, options) => { const response = await goto(url, options); if(options?.waitUntil !== 'commit')await ready(); return response; };
    page.reload = async options => { const response = await reload(options); if(options?.waitUntil !== 'commit')await ready(); return response; };
    return page;
  };
  return context;
}

async function signedIn(browser: BrowserContext["browser"], email: string) {
  const ctx = await browser!.newContext({ viewport: { width: 1600, height: 1000 } });
  await ctx.route('**/api/balance*', route=>route.fulfill({json:{balance:42.42,unit:'provider units',state:'fresh',refreshedAt:new Date().toISOString(),low:false,message:null}}));
  await ctx.addCookies([sessionCookie(email, PORT) as never]);
  return ctx;
}

// Every test starts from the same seed. Without this the suite was order-dependent
// in a way that produced convincing false positives: an assign test would hand a
// record to another employee, and a later "tick Done" test would then fail with
// "clicking the checkbox did not change its state" — which reads exactly like a UI
// bug but was really a 404 from the scope check doing its job.
function reseed() {
  const sql = readFileSync(new URL("../scripts/seed.sql", import.meta.url), "utf8");
  execFileSync("podman", ["exec", "-i", CONTAINER, "psql", "-U", "postgres",
    "-v", "ON_ERROR_STOP=1", "-q"], { input: sql, stdio: ["pipe", "ignore", "pipe"] });
}

type Fx = {
  freshDb: void;
  adminPage: Page;
  employeePage: Page;
  employee2Page: Page;
  /** Save a named full-page PNG into shots/ so it can be opened and reviewed. */
  shot: (page: Page, name: string) => Promise<string>;
};

export const test = base.extend<Fx>({
  browser: [async ({browser}, use) => {
    const original = browser.newContext.bind(browser);
    browser.newContext = async options => instrumentContext(await original(options));
    await use(browser);
    browser.newContext = original;
  }, {scope: 'worker'}],
  // auto: runs for every test, before the body touches a page
  freshDb: [async ({}, use) => { reseed(); await use(); }, { auto: true }],

  adminPage: async ({ browser }, use) => {
    const ctx = await signedIn(browser, ADMIN.email);
    const page = await ctx.newPage();
    await use(page);
    await ctx.close();
  },
  employeePage: async ({ browser }, use) => {
    const ctx = await signedIn(browser, EMPLOYEE.email);
    const page = await ctx.newPage();
    await use(page);
    await ctx.close();
  },
  employee2Page: async ({ browser }, use) => {
    const ctx = await signedIn(browser, EMPLOYEE2.email);
    const page = await ctx.newPage();
    await use(page);
    await ctx.close();
  },
  shot: async ({}, use, testInfo) => {
    await use(async (page: Page, name: string) => {
      // Some screenshots intentionally hold a request open to inspect recovery.
      // Settle fonts/paint without waiting for that request to finish.
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      });
      const file = join(SHOTS, `${name}.png`);
      await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
      await testInfo.attach(name, { path: file, contentType: "image/png" });
      return file;
    });
  },
});

export { expect };

/** Computed style of the first match, for real look-and-feel assertions. */
export async function css(page: Page, selector: string, prop: string): Promise<string> {
  return page.locator(selector).first().evaluate(
    (el, p) => getComputedStyle(el as Element).getPropertyValue(p as string).trim(),
    prop,
  );
}

/** Does the page scroll horizontally? A grid must scroll inside its own wrapper. */
export async function bodyOverflowsX(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}

/** Record a real connected attempt through the same dialog as a caller. */
export async function logConnected(page:Page,row:any){
 await row.getByRole('button',{name:'Log manual call'}).click();
 const dialog=page.getByRole('dialog');await dialog.getByLabel('What happened?').selectOption('connected');
 await dialog.getByRole('button',{name:'Record attempt'}).click();await expect(dialog).toHaveCount(0);
 await expect(row).toContainText('Connected');
}

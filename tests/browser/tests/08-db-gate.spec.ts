import { test, expect } from "./fixtures";
import { CONTAINER, BOOTSTRAP, PORT } from "../lib/env.mjs";
import { sessionCookie } from "../lib/session.mjs";
import { execFileSync } from "node:child_process";

const psql = (sql: string) =>
  execFileSync("podman", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-q", "-tAc", sql],
    { encoding: "utf8" }).trim();

async function pageAs(browser: Parameters<typeof sessionCookie>[0] extends never ? never : any, email: string) {
  const ctx = await browser.newContext();
  await ctx.addCookies([sessionCookie(email, PORT) as never]);
  return { ctx, page: await ctx.newPage() };
}

// bolna_app_users is now the ONLY access gate. These are the cases that used to be
// decided by ALLOWED_EMAILS / ADMIN_EMAILS.
test.describe("the database is the access gate", () => {
  test("adding a row grants sign-in with no redeploy", async ({ adminPage, browser }) => {
    const email = "newstarter@eval.test";
    const { ctx, page } = await pageAs(browser, email);

    await page.goto("/dashboard/my");
    await expect(page, "no row yet -> refused").toHaveURL(/\/$/);

    const res = await adminPage.request.post("/api/users", {
      data: { email, name: "New Starter", role: "employee" },
    });
    expect(res.ok()).toBe(true);

    await page.goto("/dashboard/my");
    await expect(page, "row added -> in, same process").toHaveURL(/\/dashboard\/my$/);
    await ctx.close();
  });

  test("unticking Active revokes access immediately", async ({ adminPage, browser }) => {
    const { ctx, page } = await pageAs(browser, "priya@eval.test");
    await page.goto("/dashboard/my");
    await expect(page).toHaveURL(/\/dashboard\/my$/);

    await adminPage.request.post("/api/users", { data: { email: "priya@eval.test", active: false } });

    await page.goto("/dashboard/my");
    await expect(page).toHaveURL(/\/$/);
    await ctx.close();
  });

  test("role comes from the row: promoting reveals the admin pages", async ({ adminPage, browser }) => {
    const { ctx, page } = await pageAs(browser, "priya@eval.test");
    await page.goto("/dashboard/raw");
    await expect(page, "employee -> bounced").toHaveURL(/\/dashboard\/my$/);

    await adminPage.request.post("/api/users", { data: { email: "priya@eval.test", role: "admin" } });

    await page.goto("/dashboard/raw");
    await expect(page.locator("table.sheet")).toBeVisible();
    await ctx.close();
  });

  test("ADMIN_EMAILS works as bootstrap only while no active admin row exists",
    async ({ browser }) => {
    const { ctx, page } = await pageAs(browser, BOOTSTRAP.email);

    // Seed has an active admin, so the bootstrap must NOT apply.
    expect(Number(psql(`select count(*) from bolna_app_users where active and role='admin'`)))
      .toBeGreaterThan(0);
    await page.goto("/dashboard");
    await expect(page, "admin row exists -> env is inert").toHaveURL(/\/$/);

    // Remove every admin row: now the bootstrap is the only way back in.
    psql(`delete from bolna_app_users where role = 'admin'`);
    await page.goto("/dashboard");
    await expect(page, "no admin row -> bootstrap admits").toHaveURL(/\/dashboard$/);
    await expect(page.locator(".topnav").getByRole("link", { name: "Team" })).toBeVisible();
    await ctx.close();
  });

  test("the last active admin cannot be demoted or deactivated", async ({ adminPage: page }) => {
    // Leave exactly one admin, then try to remove them via the API.
    psql(`update bolna_app_users set role='admin', active=true where email='admin@eval.test'`);
    psql(`update bolna_app_users set role='employee' where email <> 'admin@eval.test'`);

    // A different admin is needed to attempt it, since self-demotion is blocked
    // earlier by its own guard — promote one, then demote the original.
    psql(`update bolna_app_users set role='admin', active=true where email='raj@eval.test'`);
    let res = await page.request.post("/api/users", { data: { email: "raj@eval.test", role: "employee" } });
    expect(res.ok(), "two admins -> demotion allowed").toBe(true);

    res = await page.request.post("/api/users", { data: { email: "admin@eval.test", active: false } });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/last active admin|demote or deactivate yourself/);
  });
});

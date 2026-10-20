import { test, expect } from "./fixtures";
import { ADMIN, EMPLOYEE, OUTSIDER, PORT } from "../lib/env.mjs";
import { sessionCookie, forgedCookie } from "../lib/session.mjs";

test.describe("auth and role boundaries", () => {
  test("anonymous visitor gets the sign-in page, not the dashboard", async ({ page }) => {
    await page.goto("/dashboard/calls");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator(".login .card h1")).toHaveText("CallOnGo");
  });

  test("a forged cookie is rejected (HMAC, not just httpOnly)", async ({ browser }) => {
    const ctx = await browser.newContext();
    await ctx.addCookies([forgedCookie(ADMIN.email) as never]);
    const page = await ctx.newPage();
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/$/);   // bounced to login
    await ctx.close();
  });

  test("a correctly-signed email with no bolna_app_users row is refused", async ({ browser }) => {
    const ctx = await browser.newContext();
    await ctx.addCookies([sessionCookie(OUTSIDER.email, PORT) as never]);
    const page = await ctx.newPage();
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/$/);
    await ctx.close();
  });

  test("admin nav exposes all four sections", async ({ adminPage: page }) => {
    await page.goto("/dashboard");
    const nav = page.locator(".topnav");
    await expect(nav.getByRole("link", { name: "My Work" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "AI Calls" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Raw Dataset" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Team" })).toBeVisible();
  });

  test("employee nav hides Raw Dataset and Team", async ({ employeePage: page }) => {
    await page.goto("/dashboard");
    const nav = page.locator(".topnav");
    await expect(nav.getByRole("link", { name: "My Work" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "AI Calls" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Raw Dataset" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Team" })).toHaveCount(0);
  });

  test("employee visiting /dashboard/raw is redirected to their own work", async ({ employeePage: page }) => {
    await page.goto("/dashboard/raw");
    await expect(page).toHaveURL(/\/dashboard\/my$/);
  });

  test("employee visiting /dashboard/team is redirected", async ({ employeePage: page }) => {
    await page.goto("/dashboard/team");
    await expect(page).toHaveURL(/\/dashboard\/my$/);
  });

  test("employee is blocked from the admin APIs with 403", async ({ employeePage: page }) => {
    for (const url of ["/api/users", "/api/raw/queue"]) {
      const res = await page.request.get(url);
      expect(res.status(), `GET ${url}`).toBe(403);
    }
    const assign = await page.request.post("/api/assignments", {
      data: { entity_type: "record", assignee: EMPLOYEE.email, ids: [] },
    });
    expect(assign.status()).toBe(403);
    const dispatch = await page.request.post("/api/raw/dispatch", {
      data: { ids: ["a0000000-0000-4000-8000-000000000001"], confirm: true },
    });
    expect(dispatch.status()).toBe(403);
  });

  test("dispatch refuses to fire without explicit confirmation", async ({ adminPage: page }) => {
    const res = await page.request.post("/api/raw/dispatch", {
      data: { ids: ["a0000000-0000-4000-8000-000000000001"], intentKey: "00000000-0000-4000-8000-000000000001" },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain("confirm:");
  });
});

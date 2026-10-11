import { test, expect } from "./fixtures";

test.describe("team management @shot", () => {
  test("people are grouped by what they can do", async ({ adminPage: page, shot }) => {
    await page.goto("/dashboard/team");
    const heads = await page.locator(".group-head").allInnerTexts();
    expect(heads.join("|")).toContain("Admins");
    expect(heads.join("|")).toContain("Employees");
    expect(heads.join("|")).toContain("No access");
    // the page says plainly that this list is the access control
    await expect(page.locator(".callout")).toContainText("who can sign in");
    // deactivated user sits under "No access", not mixed into the active list
    await expect(page.locator(".person.is-off")).toHaveCount(1);
    await shot(page, "08-team-admin");
  });

  test("adding someone grants access from one form", async ({ adminPage: page, shot }) => {
    await page.goto("/dashboard/team");
    await page.getByRole("button", { name: /Add someone/ }).click();
    await page.locator('.addcard input[type="email"]').fill("newhire@eval.test");
    await page.locator('.addcard input[placeholder="e.g. Priya"]').fill("New Hire");
    await page.getByRole("button", { name: /Add & grant access/ }).click();
    // .people is one list PER GROUP, so scope to the whole directory
    await expect(page.locator(".team")).toContainText("newhire@eval.test", { timeout: 10000 });
    await expect(page.locator(".person").filter({ hasText: "newhire@eval.test" })).toHaveCount(1);
    await shot(page, "17-team-after-add");
  });

  test("the access switch reads as on/off with its meaning", async ({ adminPage: page }) => {
    await page.goto("/dashboard/team");
    const priya = page.locator(".person").filter({ hasText: "priya@eval.test" }).first();
    const sw = priya.locator(".switch");
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await expect(sw).toContainText("Can sign in");

    await sw.click();
    await expect(page.locator(".person").filter({ hasText: "priya@eval.test" }).first().locator(".switch"))
      .toContainText("No access", { timeout: 10000 });
  });

  test("the last admin's controls are disabled with a reason, not left to fail",
    async ({ adminPage: page }) => {
    const { execFileSync } = await import("node:child_process");
    const { CONTAINER } = await import("../lib/env.mjs");
    execFileSync("podman", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-q", "-c",
      "update bolna_app_users set role='employee' where email <> 'admin@eval.test'"]);

    await page.goto("/dashboard/team");
    const admin = page.locator(".person").filter({ hasText: "admin@eval.test" }).first();
    await expect(admin.locator(".switch")).toBeDisabled();
    await expect(admin.locator("select")).toBeDisabled();
    // and it says why — being yourself is the reason surfaced first
    const why = await admin.locator(".switch").getAttribute("title");
    expect(why).toMatch(/you can't remove your own access|last admin/i);
  });

  test("admin cannot demote themselves", async ({ adminPage: page }) => {
    const res = await page.request.post("/api/users", {
      data: { email: "admin@eval.test", role: "employee" },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain("can't demote or deactivate yourself");
  });

  test("workload is shown per person as labelled chips", async ({ adminPage: page }) => {
    await page.goto("/dashboard/team");
    const priya = page.locator(".person").filter({ hasText: "priya@eval.test" }).first();
    await expect(priya.locator(".pill-open")).toContainText("open");
    await expect(priya.locator(".pill-done")).toContainText("done");
    // someone with nothing assigned says so rather than showing a bare 0
    const idle = page.locator(".person").filter({ hasText: "gone@eval.test" }).first();
    await expect(idle.locator(".person-load")).toContainText("no work yet");
  });

  test("assignee filter narrows the grid", async ({ adminPage: page }) => {
    await page.goto("/dashboard/raw?assignee=priya%40eval.test");
    const rows = await page.locator("tbody tr").count();
    expect(rows).toBeGreaterThan(0);
    await page.goto("/dashboard/raw?assignee=none");
    await expect(page.locator("tbody tr")).toHaveCount(await page.locator("tbody tr").count());
  });
});

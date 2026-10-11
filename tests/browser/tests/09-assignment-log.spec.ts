import { test, expect } from "./fixtures";

// The admin's "who did I give this to, and what happened?" page.
test.describe("assignment log @shot", () => {
  test("reachable from nav and hub, admin only", async ({ adminPage, employeePage }) => {
    await adminPage.goto("/dashboard");
    await expect(adminPage.locator(".topnav").getByRole("link", { name: "Assignments" })).toBeVisible();
    await expect(adminPage.locator(".hub-card h2:visible").filter({ hasText: "Assignments" })).toBeVisible();

    await employeePage.goto("/dashboard/assignments");
    await expect(employeePage).toHaveURL(/\/dashboard\/my$/);
  });

  test("shows every state with who, status, tries and result", async ({ adminPage: page, shot }) => {
    await page.goto("/dashboard/assignments");

    // seed: 4 record assignments (open/done/dropped/open) + 1 call = 5
    await expect(page.locator("tbody tr")).toHaveCount(5);

    // headline counts span the whole table, not the page
    const stats = page.locator(".stat");
    await expect(stats.nth(0)).toContainText("open");
    await expect(stats.nth(2)).toContainText("unassigned");

    // both channels are labelled
    await expect(page.locator(".pill-record").first()).toContainText("manual");
    await expect(page.locator(".pill-call").first()).toContainText("AI call");

    // the done row carries its result and the remarks the employee typed
    const done = page.locator("tbody tr").filter({ hasText: "Meera Nair" }).first();
    await expect(done).toContainText("Available");
    await expect(done).toContainText("confirmed 8000 sqft");
    await expect(done.locator(".pill-done")).toBeVisible();

    // the dropped one is de-emphasised, not hidden
    await expect(page.locator("tr.row-muted")).toHaveCount(1);
    await shot(page, "15-assignment-log");
  });

  test("recent assignments show a relative time, with the exact one on hover",
    async ({ adminPage: page }) => {
    await page.goto("/dashboard/assignments");
    const cell = page.locator("tbody tr").first().locator(".assignment-date");
    // seed rows are stamped at insert, so they're minutes old
    await expect(cell).toHaveText(/just now|\d+m ago/);
    expect(await cell.getAttribute("title")).toMatch(/\d/);
  });

  test("flags exact execution disagreement while preserving source contact context", async ({ adminPage: page }) => {
    await page.goto("/dashboard/assignments");
    // seed's done row: employee said Available, the AI on that number said Unavailable
    const r = page.locator("tbody tr").filter({ hasText: "Meera Nair" }).first();
    await expect(r.locator(".review-tag").filter({hasText:"≠ AI"})).toHaveCount(0);
    await expect(r).toContainText('contact context');
    expect((await page.request.patch('/api/assignments/5',{data:{revision:0,outcome:'Unavailable'}})).status()).toBe(200);
    await page.reload();await expect(page.locator('tbody tr').filter({has:page.locator('.pill-call')}).locator('.review-tag')).toContainText('≠ AI');
  });

  test("filters by assignee, state and channel", async ({ adminPage: page }) => {
    await page.goto("/dashboard/assignments?state=open");
    expect(await page.locator("tbody tr").count()).toBeGreaterThan(0);
    await expect(page.locator(".pill-dropped")).toHaveCount(0);

    await page.goto("/dashboard/assignments?assignee=raj%40eval.test");
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.locator("table.assignment-sheet:visible tbody")).toContainText("Suresh Kumar");

    await page.goto("/dashboard/assignments?type=call");
    await expect(page.locator(".pill-call")).toHaveCount(1);
    await expect(page.locator(".pill-record")).toHaveCount(0);

    await page.goto("/dashboard/assignments?outcome=none");
    await expect(page.locator("table.assignment-sheet:visible tbody")).not.toContainText("confirmed 8000 sqft");
  });

  test("search matches owner, assignee and remarks", async ({ adminPage: page }) => {
    await page.goto("/dashboard/assignments?q=Suresh");
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await page.goto("/dashboard/assignments?q=8000");
    await expect(page.locator("table.assignment-sheet:visible tbody")).toContainText("Meera Nair");
  });

  test("unassign takes work back, after confirming", async ({ adminPage: page, shot }) => {
    await page.goto("/dashboard/assignments?assignee=raj%40eval.test");
    const r = page.locator("tbody tr").first();
    await r.getByRole("button", {name:"Unassign",exact:true}).click();                   // "Unassign"
    await expect(r.locator(".btn-row.danger")).toContainText("Confirm");
    await shot(page, "16-assignment-unassign-confirm");
    const response = page.waitForResponse(r => r.request().method() === "DELETE" && r.url().includes("/api/assignments/"));
    await r.locator(".btn-row.danger").click();
    expect((await response).status()).toBe(200);
    await expect(r.locator(".pill-dropped")).toBeVisible();
    await page.goto("/dashboard/assignments?assignee=raj%40eval.test&state=open");
    // NB: an empty result still renders one <tr> holding the message, so assert on
    // the message rather than a row count of 0.
    await expect(page.locator("table.assignment-sheet:visible tbody")).toContainText("No assignments match");

    // and it shows as unassigned rather than vanishing from the log
    await page.goto("/dashboard/assignments?assignee=raj%40eval.test");
    await expect(page.locator(".pill-dropped")).toHaveCount(1);
  });

  test("phone numbers are copyable here too", async ({ adminPage: page }) => {
    await page.goto("/dashboard/assignments");
    await expect(page.locator(".copytext button.copybtn").first()).toBeVisible();
  });

  test("empty state explains where work comes from", async ({ adminPage: page }) => {
    const { execFileSync } = await import("node:child_process");
    const { CONTAINER } = await import("../lib/env.mjs");
    execFileSync("podman", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-q",
      "-c", "truncate bolna_assignments restart identity cascade"]);
    await page.goto("/dashboard/assignments");
    await expect(page.locator("table.assignment-sheet:visible tbody")).toContainText("Nothing assigned yet");
  });
});

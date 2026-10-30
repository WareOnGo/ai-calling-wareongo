import { test, expect } from "./fixtures";

// The scope is the security boundary: an employee must see only their assignments,
// in the grid AND in the CSV export (which shares the filter builder).
test.describe("row-level scope", () => {
  test("admin sees every listing; employee sees only assigned ones", async ({ adminPage, employeePage }) => {
    await adminPage.goto("/dashboard/raw");
    await expect(adminPage.locator("tbody tr")).toHaveCount(6);

    // priya: A-1 open + A-2 done are visible; G-1 is dropped so it must NOT be.
    await employeePage.goto("/dashboard/my");
    const rows = employeePage.locator("table.sheet").first().locator("tbody tr");
    await expect(rows).toHaveCount(2);
    await expect(employeePage.locator("body")).toContainText("Raghav Sharma");
    await expect(employeePage.locator("body")).toContainText("Meera Nair");
    await expect(employeePage.locator("body")).not.toContainText("Latha Menon");
  });

  test("a dropped assignment disappears; a done one stays visible", async ({ employeePage: page }) => {
    await page.goto("/dashboard/my");
    // done row is dimmed via .row-done, not hidden
    await expect(page.locator("tr.row-done")).toHaveCount(1);
    await expect(page.locator("tr.row-done")).toContainText("Meera Nair");
  });

  test("employee's calls grid shows only their assigned call", async ({ adminPage, employeePage }) => {
    await adminPage.goto("/dashboard/calls");
    await expect(adminPage.locator("tbody tr")).toHaveCount(5);

    await employeePage.goto("/dashboard/calls");
    const rows = employeePage.locator("tbody tr");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("9811100001");
  });

  test("the CSV export inherits the scope, not just the grid", async ({ adminPage, employeePage }) => {
    const adminCsv = await (await adminPage.request.get("/api/calls/export")).text();
    const empCsv = await (await employeePage.request.get("/api/calls/export")).text();
    const dataRows = (csv: string) => csv.trim().split("\n").length - 1;
    expect(dataRows(adminCsv)).toBe(5);
    expect(dataRows(empCsv)).toBe(1);          // <- the whole point
    expect(empCsv).toContain("Assigned To");
  });

  test("an employee cannot widen a raw export by posting ids they don't own", async ({ employeePage: page }) => {
    const all = [
      "a0000000-0000-4000-8000-000000000001",
      "a0000000-0000-4000-8000-000000000003",
      "a0000000-0000-4000-8000-000000000004",
    ].join(",");
    const csv = await (await page.request.get(`/api/raw/export?ids=${all}`)).text();
    const rows = csv.trim().split("\n").length - 1;
    expect(rows).toBe(1);                      // only A-1, which is hers
    expect(csv).toContain("Raghav Sharma");
    expect(csv).not.toContain("Suresh Kumar");
  });

  test("an employee cannot PATCH a call that isn't theirs", async ({ employeePage: page }) => {
    const notMine = "c0000000-0000-4000-8000-000000000002";
    const res = await page.request.patch(`/api/calls/${notMine}`, { data: { wh_id: "hacked", revision: 0 } });
    expect(res.status()).toBe(404);
  });

  test("an employee cannot edit another employee's assignment", async ({ employee2Page: page }) => {
    // Ids are 1..5 deterministically (seed truncates with RESTART IDENTITY, then
    // inserts in a fixed order). raj owns exactly one of them.
    const results: number[] = [];
    for (const id of [1, 2, 3, 4, 5]) {
      const r = await page.request.patch(`/api/assignments/${id}`, { data: { remarks: "x", revision: 0 } });
      results.push(r.status());
    }
    expect(results.filter((s) => s === 200).length).toBe(1);   // only his open record
    expect(results.filter((s) => s === 409).length).toBe(4);
  });
});

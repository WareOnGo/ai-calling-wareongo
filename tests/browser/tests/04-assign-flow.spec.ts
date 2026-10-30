import { test, expect, css } from "./fixtures";

// The Assign button is the feature the admin actually uses; this drives it through
// the UI exactly as a person would.
test.describe("assign flow @shot", () => {
  test("Assign sits beside Export CSV on both grids", async ({ adminPage: page }) => {
    await page.goto("/dashboard/calls");
    await expect(page.locator(".btn-assign")).toBeVisible();
    await expect(page.getByRole("button", {name:/Export CSV/})).toBeVisible();   // the export link, not Assign
    await page.goto("/dashboard/raw");
    await expect(page.locator(".btn-assign")).toBeVisible();
  });

  test("modal offers both scopes and defaults to all-matching with nothing checked",
    async ({ adminPage: page, shot }) => {
    await page.goto("/dashboard/raw");
    await page.locator(".btn-assign").click();
    const modal = page.locator(".modal.confirm-modal");
    await expect(modal).toBeVisible();
    await expect(modal.locator(".assign-scope label")).toHaveCount(2);
    // "0 selected" is disabled, "all N matching" is chosen
    await expect(modal.locator(".assign-scope input").first()).toBeDisabled();
    await expect(modal.locator(".assign-scope input").nth(1)).toBeChecked();
    await expect(modal.locator(".assign-scope label").nth(1)).toContainText("All 6");
    // dropdown lists only ACTIVE users (the deactivated one must be absent)
    const opts = await modal.locator("select option").allInnerTexts();
    expect(opts.join("|")).toContain("Priya Eval");
    expect(opts.join("|")).not.toContain("Left Co");
    await shot(page, "09-assign-modal-all");
  });

  test("checking rows switches the scope to the selection", async ({ adminPage: page, shot }) => {
    await page.goto("/dashboard/raw");
    await page.locator("tbody input.rowsel:not(:disabled)").nth(0).check();
    await page.locator("tbody input.rowsel:not(:disabled)").nth(1).check();
    await page.locator(".btn-assign").click();
    const modal = page.locator(".modal.confirm-modal");
    await expect(modal.locator(".assign-scope input").first()).toBeChecked();
    await expect(modal.locator(".assign-scope label").first()).toContainText("2 selected");
    await expect(modal.locator(".assign-scope label").first()).toHaveClass(/active/);
    await shot(page, "10-assign-modal-selected");
  });

  test("select-all header checkbox ticks every selectable row", async ({ adminPage: page }) => {
    await page.goto("/dashboard/raw");
    await page.locator("th.selcol input.selall").check();
    await expect(page.locator("tbody input.rowsel:checked")).toHaveCount(5); // 6 minus no-phone
  });

  test("submitting assigns, reports skips, and the row shows the new owner",
    async ({ adminPage: page, shot }) => {
    await page.goto("/dashboard/raw");
    // B-2 (Anil Broker) is unassigned; A-1 is already priya's -> must be skipped.
    await page.locator("th.selcol input.selall").check();
    await page.locator(".btn-assign").click();
    const modal = page.locator(".modal.confirm-modal");
    await modal.locator("select").selectOption("raj@eval.test");
    await modal.locator(".assign-field input").fill("eval batch");
    await modal.getByRole("button", { name: /^Assign/ }).click();

    await expect(modal.locator(".assign-done")).toBeVisible();
    await expect(modal.locator(".assign-done")).toContainText("raj@eval.test");
    // 5 selectable rows: 3 already owned (A-1 open, A-2 done, B-1 open) -> skipped
    await expect(modal.locator(".assign-summary")).toContainText("skipped");
    await shot(page, "11-assign-result");

    await modal.getByRole("button", { name: "Done" }).click();
    await expect(page.locator("table.sheet tbody").first()).toContainText("raj@eval.test");
  });

  test("reassign takes a row from its current owner; without it the row is skipped",
    async ({ adminPage: page }) => {
    // A-1 belongs to priya in the seed. Assigning it to raj must be refused by
    // default and only succeed with "reassign" ticked — that is the whole safeguard.
    const pickA1 = async () => {
      await page.goto("/dashboard/raw");
      const row = page.locator("tbody tr").filter({ hasText: "Raghav Sharma" }).first();
      await row.locator("input.rowsel").check();
      await page.locator(".btn-assign").click();
      const modal = page.locator(".modal.confirm-modal");
      await modal.locator("select").selectOption("raj@eval.test");
      return modal;
    };

    let modal = await pickA1();
    await expect(modal.getByRole("region", {name:"Assignment preview"})).toContainText("0 eligible of 1 rows");
    await expect(modal.getByRole("button", {name:"Assign 0",exact:true})).toBeDisabled();
    await expect(modal).toContainText("1 kept with current owners");
    await modal.getByText("Assignment options", {exact:true}).click();
    await modal.getByLabel("Reassign rows already owned by someone else").check();
    await modal.getByRole("button", { name: /^Assign/ }).click();
    await expect(modal.locator(".assign-summary")).toContainText("taken from a previous owner");
  });


  test("assigning all matching leaves out records with no phone, and says so",
    async ({ adminPage: page }) => {
    // The seed has 6 records; G-2 has no number and its row checkbox is disabled.
    // "All 6 matching" must not hand that row to anyone — an employee can't call it.
    await page.goto("/dashboard/raw");
    await page.locator(".btn-assign").click();
    const modal = page.locator(".modal.confirm-modal");
    await modal.locator("select").selectOption("raj@eval.test");
    await modal.getByRole("button", { name: /^Assign/ }).click();
    await expect(modal.locator(".assign-summary")).toContainText("no phone number to call");

    const res = await page.request.post("/api/assignments", {
      data: { entity_type: "record", assignee: "raj@eval.test", filters: {} },
    });
    expect((await res.json()).skippedNoPhone).toBe(1);
  });

});

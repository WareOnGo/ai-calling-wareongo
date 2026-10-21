import { test,logConnected, expect, css } from "./fixtures";
import { BASE_URL } from "../lib/env.mjs";


// Waits for the PATCH the interaction triggers, so tests never race the save.
async function saved(page: any, action: () => Promise<void>) {
  const [res] = await Promise.all([
    page.waitForResponse((r: any) =>
      r.url().includes("/api/assignments/") && r.request().method() === "PATCH"),
    action(),
  ]);
  expect(res.status(), "the save must succeed").toBe(200);
}

const recTable = (p: any) => p.locator("table.task-sheet").first();
const row = (p: any, name: string) =>
  recTable(p).locator("tbody tr").filter({ hasText: name }).first();

test.describe("employee recording outcomes @shot", () => {
  test("the page says which columns are theirs", async ({ employeePage: page }) => {
    await page.goto("/dashboard/my");
    // legend + marked headers, so "what can I edit?" is answered by looking
    await expect(page.locator(".legend")).toContainText("read only");
    await expect(page.locator("th.mine")).toHaveCount(10);     // 5 per table, 2 tables
    await expect(page.locator("th.mine-first").first()).toContainText("Manual result");
    // and the editable cells are visually distinct from the read-only ones
    const mine = await css(page, "td.edit-cell", "background-color");
    const sys = await css(page, "table.task-sheet td.who", "background-color");
    expect(mine).not.toBe(sys);
  });

  test("result dropdown offers the AI vocabulary plus a clear empty state",
    async ({ employeePage: page }) => {
    await page.goto("/dashboard/my");
    const sel = page.locator("select.field-select").first();
    expect((await sel.locator("option").allInnerTexts()).map((s) => s.trim()))
      .toEqual(["No manual result", "Available", "Unavailable", "Unclear"]);
  });

  test("choosing a result persists", async ({ employeePage: page, shot }) => {
    await page.goto("/dashboard/my");
    await saved(page, () => page.locator("select.field-select").first().selectOption("Unclear"));
    await expect(page.locator("td.edit-cell").first()).not.toHaveClass(/err/);
    await page.reload();
    await expect(page.locator("select.field-select").first()).toHaveValue("Unclear");
    await shot(page, "12-my-work-result-set");
  });

  test("notes save on blur", async ({ employeePage: page }) => {
    await page.goto("/dashboard/my");
    const notes = page.locator('textarea.field[placeholder="What did they say?"]').first();
    await notes.fill("owner asked to call after 6pm");
    await saved(page, () => notes.blur());
    await page.reload();
    await expect(page.locator('textarea.field[placeholder="What did they say?"]').first())
      .toHaveValue("owner asked to call after 6pm");
  });

  test("there is no attempt counter any more", async ({ employeePage: page }) => {
    await page.goto("/dashboard/my");
    // The click-to-increment counter was dropped as noise; nothing should reintroduce it.
    await expect(page.locator(".btn-attempt")).toHaveCount(0);
    await expect(page.locator(".tries-meta")).toHaveCount(0);
    await expect(page.locator("th.mine").filter({ hasText: "Attempts" })).toHaveCount(0);
  });

  test("the employee records whether it reached the DB, and its WH ID",
    async ({ employeePage: page, shot }) => {
    await page.goto("/dashboard/my");
    const r = row(page, "Raghav Sharma");
    const check = r.locator('.checkfield input[type="checkbox"]');
    await expect(r.locator(".checkfield")).toContainText("Not yet");

    await saved(page, () => check.check());
    const whId = r.locator('input[aria-label="Warehouse ID"]');
    await whId.fill("1003");
    await saved(page, () => whId.blur());

    await page.reload();
    const after = row(page, "Raghav Sharma");
    await expect(after.locator('.checkfield input[type="checkbox"]')).toBeChecked();
    await expect(after.locator(".checkfield")).toContainText("Added");
    await expect(after.locator('input[aria-label="Warehouse ID"]')).toHaveValue("1003");
    await shot(page, "13-my-work-added-to-db");
  });

  test("Done retains the row and reopening respects shared-phone ownership", async ({ employeePage: page, adminPage, shot }) => {
    await page.goto("/dashboard/my");
    const btn = row(page, "Raghav Sharma").locator(".btn-done");
    await expect(btn).toContainText("Mark done");
    await expect(btn).toHaveAttribute("aria-pressed", "false");

    await saved(page, () => row(page, "Raghav Sharma").locator("select.field-select").selectOption("Unavailable"));
    await logConnected(page,row(page,"Raghav Sharma"));
    await saved(page, () => btn.click());
    await expect(btn).toHaveAttribute("aria-pressed", "true");
    await expect(btn).toContainText("Done");
    await page.reload();

    const after = row(page, "Raghav Sharma");
    await expect(after, "finished work stays visible").toBeVisible();
    await expect(after).toHaveClass(/row-done/);
    await shot(page, "14-my-work-done");

    // The legacy fixture also has open AI follow-up work for this phone.
    // Reopening must preserve Done until that competing assignment is released.
    const [conflict] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith('/api/assignments/1') && r.request().method() === 'PATCH'),
      after.locator(".btn-done").click(),
    ]);
    expect(conflict.status()).toBe(409);
    await expect(after.locator('.save-status')).toContainText('This phone number already has open work');
    await expect(after.locator('.btn-done')).toHaveAttribute('aria-pressed', 'true');
    await expect(after).toHaveClass(/row-done/);

    expect((await adminPage.request.delete('/api/assignments/5')).status()).toBe(200);
    await saved(page, () => after.getByRole('button', {name:'Retry',exact:true}).click());
    await expect(after.locator('.save-status')).toHaveText('Saved');
    await page.reload();
    await expect(row(page, "Raghav Sharma")).not.toHaveClass(/row-done/);
    await expect(row(page, "Raghav Sharma").locator('.btn-done')).toHaveAttribute('aria-pressed', 'false');
  });

  test("a finished row stays readable, distinct and editable",
    async ({ employeePage: page }) => {
    await page.goto("/dashboard/my");
    // Meera Nair is 'done' in the seed. Dimming her editable cells too would make
    // correcting a mistaken Done look impossible.
    const doneRow = row(page, "Meera Nair");
    await expect(doneRow).toHaveClass(/row-done/);
    const sysOpacity = await doneRow.locator("td.who").evaluate((e) => getComputedStyle(e).opacity);
    const editOpacity = await doneRow.locator("td.edit-cell").first()
      .evaluate((e) => getComputedStyle(e).opacity);
    // Completed work uses secondary text instead of opacity, which also faded
    // every nested label and could make corrections look unavailable.
    expect(Number(sysOpacity)).toBe(1);
    expect(Number(editOpacity)).toBe(1);
    const nameColor = (name: string) => row(page, name).locator('.contact-card-name').evaluate(e => getComputedStyle(e).color);
    expect(await nameColor('Meera Nair')).not.toBe(await nameColor('Raghav Sharma'));
    await expect(doneRow.locator('.btn-done')).toHaveAttribute('aria-pressed', 'true');
    await expect(doneRow.locator("select.field-select")).toBeEnabled();
  });

  test("the caller gets the standard listing details, not just a name",
    async ({ employeePage: page }) => {
    await page.goto("/dashboard/my");
    await expect(recTable(page).locator("th").filter({hasText:"Contact"})).toBeVisible();
    await expect(row(page, "Raghav Sharma").locator(".work-context")).toContainText("Rajkot");
    const r = row(page, "Raghav Sharma");
    await expect(r).toContainText("12,000 sqft");
    await expect(r, "a bare number reads as a code, not money").toContainText("₹45,000");

    // the AI-call table carries size/rent the LLM extracted
    const call = page.locator("table.task-sheet").nth(1).locator("tbody tr").first();
    await expect(call).toContainText("12,000 sqft");
    await expect(call).toContainText("45000 per month");
  });

  test("phone numbers are copyable, with a visible icon", async ({ employeePage: page }) => {
    // grant on the PAGE's own context — the `context` fixture is a different one,
    // since employeePage builds its own via browser.newContext().
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE_URL });
    await page.goto("/dashboard/my");
    const cell = row(page, "Raghav Sharma").locator(".copytext");
    await expect(cell).toContainText("+919811100001");
    await expect(cell.locator("button.copybtn")).toBeVisible();

    await cell.locator("button.copybtn").click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("+919811100001");
  });

  test("the admin's brief is shown on the row", async ({ employeePage: page }) => {
    await page.goto("/dashboard/my");
    await expect(row(page, "Raghav Sharma").locator(".brief")).toContainText("verify area + rent");
  });

  test("the AI's existing verdict is visible before dialling", async ({ employeePage: page }) => {
    await page.goto("/dashboard/my");
    // Two stored executions on this number; a completed but un-enriched execution
    // is consistently classified Unclear by the tracked database view.
    await expect(row(page, "Raghav Sharma").locator('.work-ai')).toContainText("AI: Unclear");
    await expect(row(page, "Raghav Sharma").locator('.work-ai')).toContainText("Attempt count unknown");
    // the follow-up table carries the enriched verdict
    await expect(page.locator("table.task-sheet").nth(1).locator("tbody tr").first())
      .toContainText("Available");
  });

  test("rows are comfortable, not spreadsheet-dense", async ({ employeePage: page }) => {
    await page.goto("/dashboard/my");
    const h = await recTable(page).locator("tbody tr").first()
      .evaluate((el) => (el as HTMLElement).getBoundingClientRect().height);
    expect(h, "task rows must be taller than the 30px admin grid").toBeGreaterThan(40);
  });

  test("the task columns fit the viewport, so no sideways scrolling at all",
    async ({ employeePage: page }) => {
    await page.goto("/dashboard/my");
    // The original complaint was an h-scrollbar hugging two rows near the TOP of an
    // empty page. Rather than move that scrollbar, the columns were trimmed so it
    // never appears — assert the absence, which is the actual goal.
    const overflow = await page.locator(".worklist .gridwrap").evaluateAll(
      (els) => els.map((e) => e.scrollWidth - e.clientWidth));
    expect(overflow.every((d) => d <= 1), `h-overflow per section: ${overflow}`).toBe(true);

    // and no dead gap: the two sections must sit close together, not split the page
    const gap = await page.evaluate(() => {
      const s = [...document.querySelectorAll(".worklist")];
      if (s.length < 2) return 0;
      return s[1].getBoundingClientRect().top - s[0].getBoundingClientRect().bottom;
    });
    expect(gap, "sections should be adjacent").toBeLessThan(40);
  });
});

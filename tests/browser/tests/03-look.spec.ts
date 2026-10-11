import { test, expect, css, bodyOverflowsX } from "./fixtures";

test.describe("look and feel @shot", () => {
  test("hub renders a card per capability, admin gets six", async ({ adminPage: page, shot }) => {
    await page.goto("/dashboard");
    await expect(page.locator(".hub-card")).toHaveCount(6);
    await expect(page.locator(".hub-card h2")).toHaveText(
      ["My Work", "Call Analytics", "Raw Dataset", "Assignments", "Batches", "Team"]);
    // cards must be a grid, not stacked divs
    expect(await css(page, ".hub-grid", "display")).toBe("grid");
    await shot(page, "01-hub-admin");
  });

  test("employee hub shows only My Work", async ({ employeePage: page, shot }) => {
    await page.goto("/dashboard");
    await expect(page.locator(".hub-card")).toHaveCount(1);
    await shot(page, "02-hub-employee");
  });

  test("calls grid: fixed layout, colour-coded availability, group toggles", async ({ adminPage: page, shot }) => {
    await page.goto("/dashboard/calls");
    const table = page.locator("table.sheet");
    await expect(table).toBeVisible();

    // ColumnResize injects a colgroup and switches to fixed layout
    await expect(table.locator("colgroup")).toHaveCount(1);
    expect(await css(page, "table.sheet", "table-layout")).toBe("fixed");

    // each availability class must actually be used by the seed data
    await expect(page.locator("td.cf-green")).toHaveCount(1);   // Available
    await expect(page.locator("td.cf-red")).toHaveCount(1);     // Unavailable
    await expect(page.locator("td.cf-gray")).toHaveCount(0);    // no-answer is retryable, never a dead number
    expect(await page.locator("td.cf-yel").count()).toBeGreaterThan(0);

    // and they must be visually distinct, not all inheriting the same colour
    const bg = async (s: string) => css(page, s, "background-color");
    const [g, r, y] = [await bg("td.cf-green"), await bg("td.cf-red"), await bg("td.cf-yel")];
    expect(new Set([g, r, y]).size).toBe(3);

    // collapsible groups start collapsed
    await expect(table).toHaveClass(/db-collapsed/);
    await expect(table).toHaveClass(/call-collapsed/);
    await expect(page.locator("th.grp-toggle")).toHaveCount(2);
    expect(await css(page, "td.db-col", "display")).toBe("none");

    // needs-review + broker + match-count tags
    await expect(page.locator(".review-tag").filter({ hasText: "review" })).toHaveCount(1);
    await expect(page.locator(".review-tag").filter({ hasText: "broker" })).toHaveCount(1);

    await shot(page, "03-calls-admin");
  });

  test("expanding a column group reveals its detail columns", async ({ adminPage: page, shot }) => {
    await page.goto("/dashboard/calls");
    expect(await css(page, "td.db-col", "display")).toBe("none");
    await page.locator("th.db-toggle button").click();
    await expect(page.locator("table.sheet")).not.toHaveClass(/db-collapsed/);
    expect(await css(page, "td.db-col", "display")).not.toBe("none");
    await shot(page, "04-calls-db-group-expanded");
  });

  test("the grid scrolls inside its wrapper, the page does not scroll sideways", async ({ adminPage: page }) => {
    await page.goto("/dashboard/calls");
    expect(await css(page, ".gridwrap", "overflow-x")).toMatch(/auto|scroll/);
    expect(await bodyOverflowsX(page)).toBe(false);
  });

  test("raw dataset shows selection column, and no-phone rows are unselectable", async ({ adminPage: page, shot }) => {
    await page.goto("/dashboard/raw");
    await expect(page.locator("th.selcol input.selall")).toHaveCount(1);
    await expect(page.locator("tbody input.rowsel")).toHaveCount(6);
    await expect(page.locator("tbody input.rowsel:disabled")).toHaveCount(1);  // G-2 has no phone
    await expect(page.locator("th").filter({ hasText: "Assigned To" })).toHaveCount(1);
    await shot(page, "05-raw-admin");
  });

  test("dark theme repaints the grid rather than leaving it light", async ({ adminPage: page, shot }) => {
    await page.goto("/dashboard/calls");
    const lightBg = await css(page, "body", "background-color");
    await page.locator(".theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const darkBg = await css(page, "body", "background-color");
    expect(darkBg).not.toBe(lightBg);
    await shot(page, "06-calls-dark");
  });

  test("my-work is a task list, not a spreadsheet", async ({ employeePage: page, shot }) => {
    await page.goto("/dashboard/my");
    await expect(page.locator(".section-head").first()).toContainText("Listings to call");
    await expect(page.locator("table.task-sheet")).toHaveCount(2);
    await expect(page.locator("select.field-select").first()).toBeVisible();  // result
    await expect(page.locator(".checkfield").first()).toBeVisible();          // in DB?
    await expect(page.locator('input[aria-label="Warehouse ID"]').first()).toBeVisible();
    await expect(page.locator(".btn-done").first()).toBeVisible();            // done
    // task rows opt out of the Sheets-like cell cursor
    expect(await css(page, "table.task-sheet tbody td", "cursor")).toBe("default");
    await shot(page, "07-my-work-employee");
  });

  test("team keeps the access directory alongside reporting", async ({ adminPage: page }) => {
    await page.goto("/dashboard/team");
    await expect(page.locator(".addcard, .add-trigger")).toHaveCount(1);
    await expect(page.locator(".person")).toHaveCount(4);
    await expect(page.locator(".person").first().locator(".avatar")).toBeVisible();
    await expect(page.locator(".team table")).toHaveCount(0);
    await expect(page.getByLabel("Team metrics table")).toBeVisible();
  });
});

// Regression: .hub is `place-items: center`, which shrink-wrapped .hub-grid to
// min-content so `auto-fit` produced one column and the cards stacked vertically.
// Asserting the computed column count catches that without a pixel snapshot.
test("hub cards lay out across the page, not stacked in one column", async ({ adminPage: page }) => {
  await page.goto("/dashboard");
  const cols = await page.locator(".hub-grid").evaluate(
    (el) => getComputedStyle(el as Element).gridTemplateColumns.split(" ").length);
  expect(cols).toBeGreaterThan(1);

  // and they must actually share rows: 4 cards should not occupy 4 distinct tops
  const tops = await page.locator(".hub-card").evaluateAll(
    (els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().top)))].length);
  expect(tops).toBeLessThan(4);
});

// Regression: the employee's editable columns were painted with
// `var(--fill-blue-bg, #f3f7ff)`, and --fill-blue-bg was never defined — so dark mode
// got a near-white fallback showing as a pale frame around every field. Every colour
// the new UI uses must come from a token that BOTH themes define.
test("the task list is actually dark in dark mode", async ({ employeePage: page, shot }) => {
  await page.goto("/dashboard/my");
  const lum = (c: string) => {
    const [r, g, b] = c.match(/\d+/g)!.slice(0, 3).map(Number);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const lightEdit = await css(page, "td.edit-cell", "background-color");

  await page.locator(".theme-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  for (const sel of ["td.edit-cell", "th.mine", "body", ".field", ".btn-done", ".legend-sys"]) {
    const bg = await css(page, sel, "background-color");
    expect(lum(bg), `${sel} must be dark, got ${bg}`).toBeLessThan(90);
  }
  // ...and text on those dark grounds must be light enough to read. The legend chip
  // shipped with a hardcoded light-theme ink and was invisible in dark mode.
  for (const sel of [".legend-sys", ".field", "td.who"]) {
    const fg = await css(page, sel, "color");
    expect(lum(fg), `${sel} text must be legible on dark, got ${fg}`).toBeGreaterThan(110);
  }
  // and the tint must still be distinguishable from the plain cells
  const darkEdit = await css(page, "td.edit-cell", "background-color");
  const darkPlain = await css(page, "table.task-sheet td.who", "background-color");
  expect(darkEdit).not.toBe(lightEdit);
  expect(darkEdit).not.toBe(darkPlain);
  await shot(page, "18-my-work-dark");
});

// Regression: swapping the phone cells to <CopyText> dropped the <mark> highlighting
// that fuzzy search relies on, because the component rendered the raw value.
test("search highlighting survives inside the copy cells", async ({ adminPage: page }) => {
  await page.goto("/dashboard/raw?q=9811100001");
  const cell = page.locator("tbody tr").first().locator(".copytext");
  await expect(cell.locator("mark")).toHaveCount(1);
  await expect(cell.locator("button.copybtn")).toBeVisible();

  await page.goto("/dashboard/calls?q=9811100002");
  await expect(page.locator("tbody tr").first().locator(".copytext mark")).toHaveCount(1);
});

// The copy button must hand over the RAW number, not the highlighted markup.
test("copying yields the plain number even when highlighted", async ({ adminPage: page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/dashboard/raw?q=9811100001");
  await page.locator("tbody tr").first().locator("button.copybtn").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("+919811100001");
});

// The fuzzy search on both admin grids needs pg_trgm (word_similarity). A database
// built from prisma/migrations alone lacked it, so every search 500'd and no test
// noticed. These exercise substring, phone and typo-tolerant matching.
test("raw grid search matches by name, phone and typo", async ({ adminPage: page }) => {
  await page.goto("/dashboard/raw?q=Suresh");
  await expect(page.locator("tbody tr")).toHaveCount(1);

  await page.goto("/dashboard/raw?q=9811100001");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody:visible")).toContainText("Raghav Sharma");

  // trigram tolerance: "Raghuv" should still find "Raghav"
  await page.goto("/dashboard/raw?q=Raghuv");
  await expect(page.locator("tbody:visible")).toContainText("Raghav Sharma");
});

test("calls grid search works too", async ({ adminPage: page }) => {
  await page.goto("/dashboard/calls?q=Meera");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody:visible")).toContainText("+919811100002");
});

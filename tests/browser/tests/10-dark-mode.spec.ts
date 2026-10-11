import { test, expect, css } from "./fixtures";

// Dark mode was broken on the new pages by an undefined token, and I only had a
// dark screenshot of the calls grid and my-work. Every new surface gets one, plus a
// contrast assertion, so this can't regress unnoticed on the pages nobody screenshots.
const LUM = (c: string) => {
  const [r, g, b] = c.match(/\d+/g)!.slice(0, 3).map(Number);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

async function goDark(page: any) {
  await page.locator(".theme-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
}

test.describe("dark mode across every page @shot", () => {
  test("assignment log", async ({ adminPage: page, shot }) => {
    await page.goto("/dashboard/assignments");
    await goDark(page);
    for (const sel of ["body", ".stat", "table.log-sheet td", ".search input"]) {
      expect(LUM(await css(page, sel, "background-color")), `${sel} bg`).toBeLessThan(90);
    }
    // pills must stay readable, not become dark-on-dark
    for (const sel of [".pill-open", ".pill-record"]) {
      const fg = LUM(await css(page, sel, "color"));
      const bg = LUM(await css(page, sel, "background-color"));
      expect(Math.abs(fg - bg), `${sel} needs contrast`).toBeGreaterThan(45);
    }
    await shot(page, "19-assignment-log-dark");
  });

  test("team directory", async ({ adminPage: page, shot }) => {
    await page.goto("/dashboard/team");
    await goDark(page);
    for (const sel of ["body", ".person", ".callout", ".avatar", ".fld input, .field"]) {
      expect(LUM(await css(page, sel, "background-color")), `${sel} bg`).toBeLessThan(95);
    }
    // the access switch must still read as on/off
    const on = await css(page, ".switch.on .switch-track", "background-color");
    const off = await css(page, ".person.is-off .switch-track", "background-color");
    expect(on).not.toBe(off);
    await shot(page, "20-team-dark");
  });

  test("raw dataset and the assign modal", async ({ adminPage: page, shot }) => {
    await page.goto("/dashboard/raw");
    await goDark(page);
    expect(LUM(await css(page, ".btn-assign", "background-color"))).toBeLessThan(95);
    expect(LUM(await css(page, ".btn-assign", "color"))).toBeGreaterThan(110);
    await page.locator(".btn-assign").click();
    for (const sel of [".modal", ".assign-scope label", ".assign-field select"]) {
      expect(LUM(await css(page, sel, "background-color")), `${sel} bg`).toBeLessThan(95);
    }
    await shot(page, "21-assign-modal-dark");
  });

  test("employee hub", async ({ employeePage: page, shot }) => {
    await page.goto("/dashboard");
    await goDark(page);
    expect(LUM(await css(page, ".hub-card", "background-color"))).toBeLessThan(90);
    await shot(page, "22-hub-dark");
  });
});

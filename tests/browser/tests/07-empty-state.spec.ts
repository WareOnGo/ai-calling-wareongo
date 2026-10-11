import { test, expect } from "./fixtures";
import { CONTAINER } from "../lib/env.mjs";
import { execFileSync } from "node:child_process";

const psql = (sql: string) =>
  execFileSync("podman", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-q", "-c", sql],
    { encoding: "utf8" });

// No restore needed: the freshDb fixture reseeds before every test.
test.describe("empty and refused states", () => {
  test("with only the admin active, they are the only assignable person",
    async ({ adminPage: page }) => {
    await page.goto("/dashboard/raw");
    await expect(page.locator(".btn-assign")).toBeEnabled();

    // listAssignees() returns every ACTIVE user, admins included — so deactivating
    // only the employees is not enough, the admin is still assignable. And the admin
    // cannot deactivate themselves either: role resolution treats an inactive row as
    // no access, so they'd be logged straight out.
    //
    // Now that a row IS the access grant, the admin cannot delete their own row to
    // leave nobody assignable — they'd log themselves out. The reachable state is:
    // every OTHER user inactive, and the admin themselves not assignable... which
    // they always are. So the honest assertion is the inverse: with only the admin
    // active, they are the only person work can be given to.
    psql(`update bolna_app_users set active = false where email <> 'admin@eval.test'`);

    await page.goto("/dashboard/raw");
    await expect(page.locator(".btn-assign")).toBeEnabled();
    await page.locator(".btn-assign").click();
    const opts = await page.locator(".modal select option").allInnerTexts();
    expect(opts.join("|")).toContain("Eval Admin");
    expect(opts.join("|")).not.toContain("Priya");
  });

  test("a deactivated user loses access even though the env allowlist still names them",
    async ({ employeePage: page }) => {
    psql(`update bolna_app_users set active = false where email = 'priya@eval.test'`);
    await page.goto("/dashboard/my");
    await expect(page).toHaveURL(/\/$/);   // bounced to sign-in
  });

  test("assigning to an inactive user is refused by the API", async ({ adminPage: page }) => {
    const res = await page.request.post("/api/assignments", {
      data: {
        entity_type: "record",
        assignee: "gone@eval.test",
        ids: ["a0000000-0000-4000-8000-000000000004"],
      },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain("must be an active user");
  });
});

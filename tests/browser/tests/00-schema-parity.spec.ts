import { test, expect } from "./fixtures";
import { CONTAINER, APP_DIR } from "../lib/env.mjs";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

test("browser database uses the complete tracked migration history", async () => {
  const rows = execFileSync("podman", ["exec", CONTAINER, "psql", "-U", "postgres", "-tAc",
    "select name || ':' || checksum from bolna_schema_migrations order by name"], { encoding: "utf8" }).trim().split("\n");
  const files = ["baseline.sql", ...readdirSync(join(APP_DIR, "database/migrations")).filter(n => n.endsWith(".sql")).map(n => `migrations/${n}`)];
  expect(rows).toHaveLength(files.length);
  for (const file of files) {
    const hash = createHash("sha256").update(readFileSync(join(APP_DIR, "database", file))).digest("hex");
    expect(rows).toContain(`${file.split('/').at(-1)}:${hash}`);
  }
});

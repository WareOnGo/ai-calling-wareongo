// Explicit disposable test target; never reads .env.local or a deployment URL.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const app = fileURLToPath(new URL("../", import.meta.url));
const browser = fileURLToPath(new URL("./browser/", import.meta.url));
const local = "postgres://postgres:bolna-fixes-test-only@127.0.0.1:55439/postgres";
const env = { ...process.env, DIRECT_URL: local, DATABASE_URL: local, TEST_DATABASE_URL: local,
  DATABASE_SSL: "disable", EVAL_DB_URL: local, EVAL_CONTAINER: "bolna-fixes-pg", PGPORT: "55439",
  PORT: "3129", EVAL_CHROMIUM_PATH: process.env.EVAL_CHROMIUM_PATH ?? (existsSync("/usr/bin/google-chrome")?"/usr/bin/google-chrome":""), SESSION_SECRET: "stage-test-secret-not-for-deployment",
  BOLNA_API_KEY: "stage-test-not-real", OPENAI_API_KEY: "stage-test-not-real", ENABLE_ENRICHMENT: "false" };
const run = (args, cwd = app) => {
  const result = spawnSync(process.execPath, args, { cwd, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
};
const stage = process.argv[2];
if (stage === "database") run(["database/migrate.mjs"]);
else if (stage === "reset-database") { run(["tests/reset-stage-database.mjs"]); run(["database/migrate.mjs", "--init"]); }
else if (stage === "integration") run(["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.integration.config.ts", ...process.argv.slice(3)]);
else if (stage === "browser-volume" || stage === "browser-volume-production") { env.EVAL_PERFORMANCE="1"; if(stage.endsWith('-production'))env.EVAL_PRODUCTION="1"; run(["node_modules/@playwright/test/cli.js", "test", "22-handoff-performance.spec.ts"],browser); }
else if (stage === "browser-production") { env.EVAL_PRODUCTION="1"; run(["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(3)],browser); }
else if (stage === "browser") run(["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(3)], browser);
else if (stage === "build") run(["node_modules/next/dist/bin/next", "build", "--webpack"]);
else if (stage === "performance") { env.BENCH_LABEL = /^[a-z0-9-]+$/.test(process.argv[3] || "current") ? (process.argv[3] || "current") : "current"; run(["node_modules/vitest/vitest.mjs","run","--config","vitest.performance.config.ts"]); }
else if (stage === "rehearsal") run(["tests/rehearse-migrations.mjs"]);
else throw new Error("Choose database, reset-database, integration, browser, browser-production, browser-volume, browser-volume-production, build, performance, or rehearsal");

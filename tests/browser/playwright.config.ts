import { defineConfig, devices } from "@playwright/test";
import { APP_DIR, BASE_URL, PORT, appEnv } from "./lib/env.mjs";

// The harness owns the whole stack: `webServer` boots the app under test against the
// eval database (started separately by `npm run db:up`, so schema/seed state is
// explicit and inspectable rather than hidden inside a global setup).
export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  fullyParallel: false,        // one shared database; parallel writes would race
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    // Screenshots/traces on failure; the visual specs take explicit named shots too.
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { width: 1600, height: 1000 },
    colorScheme: "light",
    launchOptions: process.env.EVAL_CHROMIUM_PATH ? { executablePath: process.env.EVAL_CHROMIUM_PATH } : {},
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],

  webServer: {
    command: `npx next ${process.env.EVAL_PRODUCTION ? "start" : "dev --webpack"} --port ${PORT}`,
    cwd: APP_DIR,
    url: BASE_URL,
    // false on purpose: with `true`, a half-dead next-server still holding the port
    // (e.g. SIGTERM'd but its socket not yet released) looks "up" to Playwright, which
    // then runs the whole suite against a listener that accepts and never responds —
    // 43 identical ERR_ABORTED timeouts. Owning the lifecycle also guarantees the
    // server has the env from lib/env.mjs rather than whatever a stale one had.
    reuseExistingServer: false,
    timeout: 180_000,
    env: { ...appEnv(), ...(process.env.EVAL_PRODUCTION ? { NODE_ENV: "production" } : {}) },
    stdout: "pipe",
    stderr: "pipe",
  },
});

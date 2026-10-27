// Starts the app under test against the harness database.
//
// `next dev` (not build+start) so a code change is picked up on the next run without
// a rebuild step — the point of this harness is a fast look → fix → look loop.
import { spawn, execFileSync } from "node:child_process";
import { openSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { APP_DIR, PORT, BASE_URL, appEnv } from "../lib/env.mjs";

const PID_FILE = new URL("../.app.pid", import.meta.url);
const LOG = new URL("../app.log", import.meta.url);

async function waitHttp(url, ms = 120000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(url, { redirect: "manual" });
      if (r.status > 0) return r.status;
    } catch { /* not up yet */ }
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${url}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function start() {
  if (existsSync(PID_FILE)) {
    console.log("already running (see .app.pid); use app:stop first");
    return;
  }
  const out = openSync(LOG, "w");
  const child = spawn("npx", ["next", "dev", "--port", String(PORT)], {
    cwd: APP_DIR, env: appEnv(), detached: true, stdio: ["ignore", out, out],
  });
  child.unref();
  const { writeFileSync } = await import("node:fs");
  writeFileSync(PID_FILE, String(child.pid));
  const status = await waitHttp(BASE_URL);
  console.log(`app up at ${BASE_URL} (pid ${child.pid}, first response ${status})`);
}

function stop() {
  if (!existsSync(PID_FILE)) { console.log("not running"); return; }
  const pid = Number(readFileSync(PID_FILE, "utf8").trim());
  try { process.kill(-pid, "SIGTERM"); } catch { /* already gone */ }
  try { execFileSync("pkill", ["-f", `next dev --port ${PORT}`]); } catch { /* fine */ }
  unlinkSync(PID_FILE);
  console.log("app stopped");
}

const cmd = process.argv[2];
if (cmd === "start") await start();
else if (cmd === "stop") stop();
else { console.error("usage: app.mjs start|stop"); process.exit(1); }

// Disposable local PostgreSQL only. Apply the same tracked migrations as CI.
import { execFileSync } from "node:child_process";
import { readFileSync,mkdirSync } from "node:fs";
import { APP_DIR, CONTAINER, PGPORT, DB_URL } from "../lib/env.mjs";
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", ...opts });
const psql = sql => sh("podman", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-tA"], { input: sql });
const migrate = () => {
  const exists = psql("select to_regclass('public.bolna_call_logs') is not null").trim() === "t";
  sh(process.execPath, ["database/migrate.mjs", ...(!exists ? ["--init"] : [])], {
    cwd: APP_DIR, stdio: "inherit", env: { ...process.env, DIRECT_URL: DB_URL, DATABASE_URL: DB_URL, DATABASE_SSL: "disable" },
  });
};
async function up() {
  try { sh("podman", ["container", "exists", CONTAINER]); sh("podman", ["start", CONTAINER]); }
  catch { const dataDir=process.env.EVAL_DATA_DIR; if(dataDir)mkdirSync(dataDir,{recursive:true}); sh("podman", ["run", "-d", "--name", CONTAINER, ...(dataDir?["-v",`${dataDir}:/var/lib/postgresql/data:Z`]:[]), "-e", `POSTGRES_PASSWORD=${new URL(DB_URL).password}`, "-p", `127.0.0.1:${PGPORT}:5432`, "docker.io/library/postgres:17-alpine"]); }
  for (let i = 0; i < 60; i++) {
    try { psql("select 1"); break; }
    catch (error) { if (i === 59) throw error; await new Promise(r => setTimeout(r, 1000)); }
  }
  migrate();
}
const cmd = process.argv[2];
if (cmd === "up") await up();
else if (cmd === "migrate") migrate();
else if (cmd === "seed") psql(readFileSync(new URL("./seed.sql", import.meta.url), "utf8"));
else if (cmd === "down") sh("podman", ["stop", CONTAINER]);
else if (cmd === "reset") {
  psql("drop schema public cascade; create schema public;"); migrate();
  psql(readFileSync(new URL("./seed.sql", import.meta.url), "utf8"));
} else throw new Error("usage: db.mjs up|down|seed|migrate|reset");

// Keep the live preview independent of production builds used by browser tests.
import { spawn } from "node:child_process";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const app = fileURLToPath(new URL("../", import.meta.url));
loadEnvFile(resolve(app, process.argv[2] || ".env.local"));
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--webpack", "--port", "3000"], {
  cwd: app, stdio: "inherit", env: { ...process.env, BOLNA_PREVIEW_DIST_DIR: ".next-preview" },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", error => { console.error(error.message); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });

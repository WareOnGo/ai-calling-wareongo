// Browser harness uses the application repository and a disposable test database.
import { fileURLToPath } from "node:url";

export const APP_DIR = process.env.APP_DIR ?? fileURLToPath(new URL("../../../", import.meta.url));
export const CONTAINER = process.env.EVAL_CONTAINER ?? "bolna-eval-pg";
export const PGPORT = Number(process.env.PGPORT ?? 55433);
// 3100 is taken on this machine by an unrelated service (WareOnGo Website Backend).
// Override with PORT= if 3120 ever clashes too.
export const PORT = Number(process.env.PORT ?? 3120);
export const BASE_URL = `http://localhost:${PORT}`;
export const DB_URL = process.env.EVAL_DB_URL ?? `postgres://postgres:x@localhost:${PGPORT}/postgres`;
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(DB_URL).hostname)) {
  throw new Error("The browser harness requires a disposable local database");
}

// The harness mints its own session cookies, so it needs the same secret the app
// signs with. Value is arbitrary — it just has to match between the two.
export const SESSION_SECRET = "eval-harness-session-secret-do-not-use-in-prod";

export const ADMIN = { email: "admin@eval.test", name: "Eval Admin" };
export const EMPLOYEE = { email: "priya@eval.test", name: "Priya Eval" };
export const EMPLOYEE2 = { email: "raj@eval.test", name: "Raj Eval" };
export const OUTSIDER = { email: "nobody@eval.test", name: "No row in bolna_app_users" };
// In ADMIN_EMAILS but with no row: admitted only while the table has no active admin.
export const BOOTSTRAP = { email: "bootstrap@eval.test", name: "Bootstrap Admin" };

// Env handed to `next dev`. Deliberately minimal: page rendering must not require
// OpenAI/Bolna credentials — only /api/enrich and /api/raw/dispatch do, and those
// are not exercised against real providers here.
export function appEnv() {
  return {
    ...process.env,
    NODE_ENV: "development",
    PORT: String(PORT),
    DATABASE_URL: DB_URL,
    DIRECT_URL: DB_URL,
    DATABASE_SSL: "disable",
    SESSION_SECRET,
    // ALLOWED_EMAILS is no longer read by the app — access comes from
    // bolna_app_users (see scripts/seed.sql). ADMIN_EMAILS is bootstrap-only and
    // deliberately set to an address with NO row, so the bootstrap path can be
    // tested without it also granting the normal fixtures their access.
    ADMIN_EMAILS: BOOTSTRAP.email,
    ENABLE_ENRICHMENT: "false",
    OPENAI_API_KEY: "sk-eval-not-used",
    PROCESS_SECRET: "eval-process-secret",
    BOLNA_API_KEY: "eval-not-used",
    CALLYZER_API_TOKEN: "eval-not-used",
    CALLYZER_ACCOUNT_KEY: "browser-test",
    CALLYZER_BASE_URL: "https://sandbox.api.callyzer.co/api/v2.2/",
    BOLNA_AGENT_ID: "00000000-0000-0000-0000-000000000001",
    BOLNA_ENGLISH_AGENT_ID: "00000000-0000-0000-0000-000000000002",
    BOLNA_WEBHOOK_SECRET: "eval-webhook-secret",
    GOOGLE_CLIENT_ID: "eval.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "eval-google-secret",
  };
}

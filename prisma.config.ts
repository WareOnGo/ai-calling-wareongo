import { defineConfig, env } from "prisma/config";

// Prisma reads `.env`, but this project keeps secrets in `.env.local` (the Next.js
// convention). Node's built-in loader handles it with no dotenv dependency.
// Wrapped: the file is absent in CI / on Vercel, where no prisma command runs anyway.
// An explicitly-exported DIRECT_URL wins, so a one-off can be run against another
// database without editing this file.
if (!process.env.DIRECT_URL) {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    /* no .env.local — rely on the ambient environment */
  }
}

// Prisma's `sslmode=require` verifies the certificate chain and fails against the
// Supabase pooler with a bare "P1001 can't reach database server" (the connection is
// fine — `pg` reaches it, and so does prisma on `prefer`). `prefer` negotiates TLS
// without client-side chain verification; because the Supabase pooler REQUIRES TLS
// server-side, the connection is still encrypted. This is the same tradeoff
// src/lib/db.ts already makes with `ssl: { rejectUnauthorized: false }`.
//
// Preferred long-term fix: download Supabase's CA cert and keep sslmode=require with
// `sslcert=`. Until then, don't "restore" require here — it just breaks every command.
function migrationUrl(): string {
  const u = new URL(env("DIRECT_URL"));
  if (u.searchParams.get("sslmode") === "require") u.searchParams.set("sslmode", "prefer");
  return u.toString();
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    // DIRECT_URL is the Supabase SESSION pooler (5432). The app's DATABASE_URL is the
    // TRANSACTION pooler (6543, pgbouncer), which can't run DDL or hold the advisory
    // lock Prisma Migrate takes — so every prisma command must go through this one.
    url: migrationUrl(),

    // Replaying migrations (`migrate diff --from-migrations`, `migrate dev`) needs a
    // scratch database Prisma can create and drop at will. Supabase won't give you
    // one, and pointing this at prod would be catastrophic — so it is opt-in via env
    // and expected to be a local throwaway, e.g.
    //   SHADOW_DATABASE_URL="postgres://postgres:x@localhost:55432/postgres?sslmode=disable"
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});

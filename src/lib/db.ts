import { Pool, type QueryResultRow } from "pg";

// Reuse a single pool across hot serverless invocations.
const globalForPg = globalThis as unknown as { __pgPool?: Pool };

export function getPool(): Pool {
  if (!globalForPg.__pgPool) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set");
    }
    // Strip ssl/pgbouncer query params so pg uses our explicit ssl config below
    // (sslmode=require is otherwise treated as verify-full and rejects Supabase's cert).
    const u = new URL(process.env.DATABASE_URL);
    for (const k of ["sslmode", "pgbouncer", "connection_limit"]) {
      u.searchParams.delete(k);
    }
    globalForPg.__pgPool = new Pool({
      connectionString: u.toString(),
      // Small pool: serverless concurrency is handled by Supabase's pooler.
      max: 6,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      // Supabase pooler requires TLS.
      ssl: { rejectUnauthorized: false },
    });
  }
  return globalForPg.__pgPool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
) {
  return getPool().query<T>(text, params as never[]);
}

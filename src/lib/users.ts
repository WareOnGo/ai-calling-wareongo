import { query } from "@/lib/db";

// app_users is the real account list, replacing the CALLED_BY_OPTIONS env var
// (which held bare first names and couldn't be assigned to).
//
// Role resolution is DB-first with an ENV FALLBACK: if there's no app_users row,
// the ADMIN_EMAILS / ALLOWED_EMAILS allowlist still decides. That keeps the table
// optional during rollout and means a bad/missing row can never lock an admin out.

export type Role = "admin" | "employee";

export type AppUser = {
  email: string;
  name: string | null;
  role: Role;
  active: boolean;
  created_at?: string;
};

export async function listUsers(): Promise<AppUser[]> {
  const res = await query<AppUser>(
    `select email, name, role, active, created_at::text as created_at
       from bolna_app_users order by active desc, role, email`,
  );
  return res.rows;
}

/** Assignable people — the dropdown in the Assign modal. */
export async function listAssignees(): Promise<AppUser[]> {
  const res = await query<AppUser>(
    `select email, name, role, active from bolna_app_users
      where active order by coalesce(nullif(name, ''), email)`,
  );
  return res.rows;
}

export async function getUser(email: string): Promise<AppUser | null> {
  const res = await query<AppUser>(
    `select email, name, role, active from bolna_app_users where email = $1`,
    [email.toLowerCase()],
  );
  return res.rows[0] ?? null;
}

export async function upsertUser(u: {
  email: string;
  name?: string | null;
  role?: Role;
  active?: boolean;
}): Promise<AppUser> {
  const res = await query<AppUser>(
    `insert into bolna_app_users (email, name, role, active)
     values ($1, $2, coalesce($3, 'employee'), coalesce($4, true))
     on conflict (email) do update set
       name   = coalesce(excluded.name,   bolna_app_users.name),
       role   = coalesce($3,              bolna_app_users.role),
       active = coalesce($4,              bolna_app_users.active)
     returning email, name, role, active`,
    [u.email.toLowerCase(), u.name ?? null, u.role ?? null, u.active ?? null],
  );
  return res.rows[0];
}

/** Open-work counts per assignee, for the admin team page. */
export type Workload = { assignee: string; entity_type: string; state: string; n: number };

export async function getWorkload(): Promise<Workload[]> {
  const res = await query<Workload & { n: string }>(
    `select assignee, entity_type, state, count(*)::text as n
       from bolna_assignments group by 1, 2, 3 order by 1, 2, 3`,
  );
  return res.rows.map((r) => ({ ...r, n: Number(r.n) }));
}

import { ApiError } from "./api";
import { query, transaction } from "@/lib/db";
import { callyzerAccount, normalizeEmployeeNumber, trackingStart, type CallyzerDevice } from "./callyzer";

// bolna_app_users is THE access list. A row here is what lets someone sign in, and
// its role is what makes them an admin — there is no env allowlist any more.
//
// The one exception is bootstrap: ADMIN_EMAILS still applies while this table has no
// active admin, otherwise an empty table would lock everyone out of the very page
// that populates it. See resolveAccess() in lib/auth.ts.

export type Role = "admin" | "employee";

export type AppUser = {
  email: string;
  name: string | null;
  role: Role;
  active: boolean;
  created_at?: string;
  callyzer_number?: string | null;
  callyzer_tracking_since?: string | null;
  callyzer_device?: CallyzerDevice | null;
};

export async function listUsers(): Promise<AppUser[]> {
  const res = await query<AppUser>(
    `select email, name, role, active, created_at::text as created_at,
       callyzer_number,callyzer_tracking_since::text,callyzer_device
       from bolna_app_users order by active desc, role, email`,
  );
  return res.rows;
}

/** Active team members — shared by assignment and Called By dropdowns. */
export async function listAssignees(): Promise<AppUser[]> {
  const res = await query<AppUser>(
    `select email, name, role, active from bolna_app_users
      where active order by coalesce(nullif(name, ''), email)`,
  );
  return res.rows;
}

/**
 * How many active admins exist. Used for two things that both protect against
 * lockout: gating the ADMIN_EMAILS bootstrap (it stops applying once a real admin
 * row exists) and refusing to demote or deactivate the last admin.
 */
export async function countActiveAdmins(): Promise<number> {
  const res = await query<{ n: string }>(
    `select count(*)::text n from bolna_app_users where active and role = 'admin'`,
  );
  return Number(res.rows[0].n);
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
  callyzer_number?: string | null;
  callyzer_since?: string | null;
}): Promise<AppUser> {
  const linking = u.callyzer_number !== undefined;
  let number: string | null = null, since: string | null = null;
  if (linking && u.callyzer_number) {
    try { number = normalizeEmployeeNumber(u.callyzer_number); since = trackingStart(u.callyzer_since || ""); }
    catch (error) { throw new ApiError(400, error instanceof Error ? error.message : "Invalid Callyzer link"); }
    if (Date.parse(since) > Date.now()) throw new ApiError(400, "Tracking date cannot be in the future");
  } else if (u.callyzer_since) throw new ApiError(400, "A Callyzer number is required with a tracking date");
  return transaction(async client => {
    // All role writes serialize, including two admins attempting to remove each other.
    await client.query("select pg_advisory_xact_lock(81620401)");
    if (linking && !(await client.query("select 1 from bolna_app_users where email=$1",[u.email.toLowerCase()])).rowCount) {
      throw new ApiError(404, "Add this caller in Access control before linking Callyzer");
    }
    if (u.role === "employee" || u.active === false) {
      const check = await client.query(`select 1 from bolna_app_users where email = $1 and active and role = 'admin'
        and (select count(*) from bolna_app_users where active and role = 'admin') <= 1`, [u.email.toLowerCase()]);
      if (check.rowCount) throw new ApiError(409, "Promote another active admin first");
    }
    const res = await client.query<AppUser>(
      `insert into bolna_app_users (email, name, role, active)
       values ($1, $2, coalesce($3, 'employee'), coalesce($4, true))
       on conflict (email) do update set
         name   = case when $5 then excluded.name else bolna_app_users.name end,
         role   = coalesce($3,              bolna_app_users.role),
         active = coalesce($4,              bolna_app_users.active)
       returning email, name, role, active`,
      [u.email.toLowerCase(), u.name ?? null, u.role ?? null, u.active ?? null, u.name !== undefined],
    );
    if (linking) {
      const duplicate = number && (await client.query("select 1 from bolna_app_users where callyzer_number=$1 and email<>$2",[number,u.email.toLowerCase()])).rowCount;
      if (duplicate) throw new ApiError(409, "This Callyzer number is already linked to another caller");
      const linked = await client.query<AppUser>(`update bolna_app_users set
        callyzer_device=case when callyzer_number is distinct from $2 then null else callyzer_device end,
        callyzer_number=$2,callyzer_tracking_since=$3 where email=$1
        returning email,name,role,active,callyzer_number,callyzer_tracking_since::text,callyzer_device`,[u.email.toLowerCase(),number,since]);
      if (number) await client.query(`update callyzer_calls set caller_email=$1 where account_key=$2
        and employee_number=$3 and occurred_at >= $4::timestamptz and caller_email is null`,[u.email.toLowerCase(),callyzerAccount(),number,since]);
      return linked.rows[0];
    }
    return res.rows[0];
  });
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

export type AssigneeWorkload={email:string;name:string|null;open:number;manual_open:number;ai_open:number;done_today:number};
/** Today's valid completions use Indian calendar boundaries, independent of server TZ. */
export async function getAssigneeWorkloads(asOf = new Date()):Promise<AssigneeWorkload[]> {
  return (await query<AssigneeWorkload>(`select u.email,u.name,
    count(a.id) filter(where a.state='open')::int as open,
    count(a.id) filter(where a.state='open' and a.entity_type='record')::int as manual_open,
    count(a.id) filter(where a.state='open' and a.entity_type='call')::int as ai_open,
    count(a.id) filter(where a.state='done' and a.completed_at >= date_trunc('day',$1::timestamptz at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'
      and a.completed_at < (date_trunc('day',$1::timestamptz at time zone 'Asia/Kolkata')+interval '1 day') at time zone 'Asia/Kolkata'
      and bolna_assignment_quality(a.state,a.outcome,a.wh_id,a.remarks,a.disposition,a.closure_reason) is null)::int as done_today
    from bolna_app_users u left join bolna_assignments a on a.assignee=u.email where u.active
    group by u.email,u.name order by coalesce(nullif(u.name,''),u.email)`,[asOf.toISOString()])).rows;
}

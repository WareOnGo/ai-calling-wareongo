import { NextRequest, NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { listUsers, upsertUser, getUser, countActiveAdmins, type Role } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({ users: await listUsers() });
}

// Create or update a user. Upsert rather than POST/PATCH split — the admin page
// only ever needs "make this row look like this".
export async function POST(req: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "a valid email is required" }, { status: 400 });
  }
  if (body.role != null && body.role !== "admin" && body.role !== "employee") {
    return NextResponse.json({ error: "role must be admin | employee" }, { status: 400 });
  }
  // Guard against an admin locking themselves out of the admin pages in one click.
  if (email === admin.email.toLowerCase() && (body.role === "employee" || body.active === false)) {
    return NextResponse.json({ error: "you can't demote or deactivate yourself" }, { status: 400 });
  }

  // Now that bolna_app_users is the ONLY access gate, removing the last admin would
  // leave nobody able to reach this endpoint — recoverable only by hand-editing the
  // database. The ADMIN_EMAILS bootstrap does not help: it only applies when there
  // is no admin ROW, and a demoted/deactivated row still exists.
  const losingAdmin = body.role === "employee" || body.active === false;
  if (losingAdmin) {
    const target = await getUser(email);
    if (target?.active && target.role === "admin" && (await countActiveAdmins()) <= 1) {
      return NextResponse.json(
        { error: "that's the last active admin — promote someone else first" },
        { status: 400 },
      );
    }
  }

  const user = await upsertUser({
    email,
    name: typeof body?.name === "string" ? body.name.trim() || null : undefined,
    role: (body.role as Role) ?? undefined,
    active: typeof body?.active === "boolean" ? body.active : undefined,
  });

  // A row here IS the access grant — no env allowlist to keep in sync any more.
  return NextResponse.json({ ok: true, user });
}

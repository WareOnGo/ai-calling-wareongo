import { NextRequest, NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { listUsers, upsertUser, type Role } from "@/lib/users";

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

  const user = await upsertUser({
    email,
    name: typeof body?.name === "string" ? body.name.trim() || null : undefined,
    role: (body.role as Role) ?? undefined,
    active: typeof body?.active === "boolean" ? body.active : undefined,
  });

  // NB: app_users grants a ROLE, not access. ALLOWED_EMAILS / ADMIN_EMAILS is still
  // the outer gate in lib/auth.ts, so a new row also needs the email allowlisted.
  return NextResponse.json({ ok: true, user });
}

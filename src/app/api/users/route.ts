import { z } from "zod";
import { jsonBody, apiError } from "@/lib/api";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { listUsers, upsertUser } from "@/lib/users";

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

  try {
  const body = await jsonBody(req, z.object({
    email: z.string().trim().email().transform(v => v.toLowerCase()),
    name: z.string().trim().max(200).nullable().optional(), role: z.enum(["admin", "employee"]).optional(), active: z.boolean().optional(),
  }).strict());
  const email = body.email;
  // Guard against an admin locking themselves out of the admin pages in one click.
  if (email === admin.email.toLowerCase() && (body.role === "employee" || body.active === false)) {
    return NextResponse.json({ error: "you can't demote or deactivate yourself" }, { status: 400 });
  }

  const user = await upsertUser({
    email,
    name: body.name === undefined ? undefined : body.name || null,
    role: body.role ?? undefined,
    active: typeof body?.active === "boolean" ? body.active : undefined,
  });

  // A row here IS the access grant — no env allowlist to keep in sync any more.
  return NextResponse.json({ ok: true, user });
  } catch (error) { return apiError(error); }
}

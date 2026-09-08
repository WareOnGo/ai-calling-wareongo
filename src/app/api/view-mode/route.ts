import { NextResponse } from "next/server";
import { getCurrentUser, VIEW_COOKIE } from "@/lib/auth";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user?.canSwitchView) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (body?.mode !== "admin" && body?.mode !== "employee") {
    return NextResponse.json({ error: "Choose Admin view or Employee view." }, { status: 400 });
  }
  const response = NextResponse.json({ mode: body.mode });
  response.cookies.set(VIEW_COOKIE, body.mode === "employee" ? `employee:${user.email}` : "", {
    httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production",
    maxAge: body.mode === "employee" ? 60 * 60 * 24 * 30 : 0,
  });
  return response;
}

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { callbackUrl, originFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

const STATE_COOKIE = "bp_oauth_state";

export async function GET(req: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(`${originFromRequest(req)}/?error=oauth_not_configured`);
  }
  // redirect_uri is derived from the current host, so it matches wherever the
  // user is (localhost or the deployed domain).
  const redirectUri = callbackUrl(req);

  const state = randomBytes(16).toString("hex");
  const c = await cookies();
  c.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
    secure: process.env.NODE_ENV === "production",
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });
  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
  );
}

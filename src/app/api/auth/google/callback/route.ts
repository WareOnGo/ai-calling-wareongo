import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { setSessionEmail, isAllowed, originFromRequest, callbackUrl } from "@/lib/auth";

export const runtime = "nodejs";

const STATE_COOKIE = "bp_oauth_state";

type TokenResponse = { access_token?: string; id_token?: string; error?: string };
type UserInfo = { email?: string; email_verified?: boolean; name?: string };

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = originFromRequest(req);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) return NextResponse.redirect(`${origin}/?error=${encodeURIComponent(oauthError)}`);
  if (!code || !state) return NextResponse.redirect(`${origin}/?error=missing_code`);

  const c = await cookies();
  const expectedState = c.get(STATE_COOKIE)?.value;
  c.delete(STATE_COOKIE);
  if (!expectedState || expectedState !== state) {
    return NextResponse.redirect(`${origin}/?error=invalid_state`);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${origin}/?error=oauth_not_configured`);
  }
  // Must be the SAME redirect_uri used in the auth request (Google validates it).
  const redirectUri = callbackUrl(req);

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) return NextResponse.redirect(`${origin}/?error=token_exchange_failed`);
  const tokenJson = (await tokenRes.json()) as TokenResponse;
  if (!tokenJson.access_token) return NextResponse.redirect(`${origin}/?error=no_access_token`);

  const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  if (!userRes.ok) return NextResponse.redirect(`${origin}/?error=userinfo_failed`);
  const userInfo = (await userRes.json()) as UserInfo;

  if (!userInfo.email || !userInfo.email_verified) {
    return NextResponse.redirect(`${origin}/?error=email_not_verified`);
  }
  if (!isAllowed(userInfo.email)) {
    return NextResponse.redirect(
      `${origin}/?error=not_allowed&email=${encodeURIComponent(userInfo.email)}`,
    );
  }

  await setSessionEmail(userInfo.email);
  return NextResponse.redirect(`${origin}/dashboard`);
}

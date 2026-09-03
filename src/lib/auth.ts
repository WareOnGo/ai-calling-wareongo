import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHmac, timingSafeEqual } from "crypto";
import { getUser, countActiveAdmins } from "@/lib/users";

// Cookie-based session. The cookie value is the email plus an HMAC signature, so
// it CANNOT be forged: a user can set their own cookie, but without SESSION_SECRET
// they can't produce a valid signature for an allowlisted email. (httpOnly only
// stops JS from reading it — it does not stop a user from setting one.)

const COOKIE_NAME = "bp_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// Secret for signing sessions. Falls back to other server secrets so the app is
// never accidentally left signing with an empty key.
function sessionSecret(): string {
  const s = process.env.SESSION_SECRET || process.env.PROCESS_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  if (!s) throw new Error("SESSION_SECRET (or PROCESS_SECRET) is not set — cannot sign sessions");
  return s;
}

function sign(email: string): string {
  return createHmac("sha256", sessionSecret()).update(email.toLowerCase()).digest("base64url");
}

// "<email>.<sig>" — verified with a constant-time compare.
function makeToken(email: string): string {
  return `${email.toLowerCase()}.${sign(email)}`;
}

function verifyToken(token: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const email = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(email);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return email;
}

export type CurrentUser = { email: string; name: string | null; isAdmin: boolean };

// Derive the public origin from the request (works on localhost and behind
// Vercel's proxy) so the OAuth redirect_uri always matches the host the user
// is actually on — no per-environment GOOGLE_REDIRECT_URI needed.
export function originFromRequest(req: Request): string {
  const h = req.headers;
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

export function callbackUrl(req: Request): string {
  return `${originFromRequest(req)}/api/auth/google/callback`;
}

function emailSet(envVar: string): Set<string> {
  return new Set(
    (process.env[envVar] ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

// ALLOWED_EMAILS is gone: access is granted by a bolna_app_users row, not by env.
// ADMIN_EMAILS survives only as the bootstrap escape hatch below.

export async function setSessionEmail(email: string): Promise<void> {
  const c = await cookies();
  c.set(COOKIE_NAME, makeToken(email), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
    secure: process.env.NODE_ENV === "production",
  });
}

export async function clearSession(): Promise<void> {
  const c = await cookies();
  c.delete(COOKIE_NAME);
}

export async function getSessionEmail(): Promise<string | null> {
  const c = await cookies();
  const token = c.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token); // null if the signature doesn't validate (forged/tampered)
}

/**
 * THE access decision. `bolna_app_users` is the only thing that grants access:
 *
 *   row + active   -> in, role from the row
 *   row + inactive -> out (offboarding without touching env or redeploying)
 *   no row         -> out, EXCEPT the bootstrap case below
 *
 * Bootstrap: an empty table would lock everyone out of the page that populates it,
 * so an email in ADMIN_EMAILS is admitted as an admin *only while no active admin
 * row exists*. The moment a real admin row is created, ADMIN_EMAILS stops having any
 * effect — so it can't quietly persist as a second, invisible access path.
 *
 * Fails CLOSED on a database error. The previous version degraded to the env
 * allowlist to survive a DB blip, but that is no longer a coherent fallback (env is
 * not the access list any more), and every page behind this guard needs Postgres to
 * render anyway — so a DB outage means "signed out", not "signed in with guessed
 * permissions".
 */
async function resolveAccess(email: string): Promise<CurrentUser | null> {
  const e = email.toLowerCase();
  try {
    const row = await getUser(e);
    if (row) {
      if (!row.active) return null;
      return { email: e, name: row.name, isAdmin: row.role === "admin" };
    }
    if (!emailSet("ADMIN_EMAILS").has(e)) return null;
    if ((await countActiveAdmins()) > 0) return null;   // bootstrap already used
    console.warn(`[auth] bootstrap admin ${e} admitted via ADMIN_EMAILS — no admin row exists yet`);
    return { email: e, name: null, isAdmin: true };
  } catch (err) {
    console.error("[auth] access lookup failed; denying:", err);
    return null;
  }
}

/** Can this Google account sign in at all? Used by the OAuth callback. */
export async function canSignIn(email: string): Promise<boolean> {
  return (await resolveAccess(email)) !== null;
}

// cache() → one access resolution (normally one query) per request.
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const email = await getSessionEmail();
  if (!email) return null;
  return resolveAccess(email);
});

export async function requireUser(): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) redirect("/");
  return u;
}

/** Page guard for admin-only routes — employees are bounced to their own view. */
export async function requireAdmin(): Promise<CurrentUser> {
  const u = await requireUser();
  if (!u.isAdmin) redirect("/dashboard/my");
  return u;
}

/** API guard for admin-only routes. Returns null for anonymous AND for employees. */
export async function getCurrentAdmin(): Promise<CurrentUser | null> {
  const u = await getCurrentUser();
  return u?.isAdmin ? u : null;
}

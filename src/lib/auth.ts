import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { makeToken, verifyToken, SESSION_MAX_AGE } from "./session";
import { getUser, countActiveAdmins } from "@/lib/users";

const COOKIE_NAME = "bp_session";
const MAX_AGE = SESSION_MAX_AGE;
export const VIEW_COOKIE = "bp_view";

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required");
  return secret;
}

export type CurrentUser = { email: string; name: string | null; isAdmin: boolean; canSwitchView?: boolean };

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
  c.delete(VIEW_COOKIE);
  c.set(COOKIE_NAME, makeToken(email, sessionSecret()), {
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
  c.delete(VIEW_COOKIE);
}

export async function getSessionEmail(): Promise<string | null> {
  const c = await cookies();
  const token = c.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token, sessionSecret()); // null if the signature doesn't validate (forged/tampered)
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
 * Database errors propagate so the OAuth callback can distinguish an unavailable
 * access lookup from an actual denial. Neither case grants a session.
 */
async function resolveAccess(email: string): Promise<CurrentUser | null> {
  const e = email.toLowerCase();
  const row = await getUser(e);
  if (row) {
    if (!row.active) return null;
    return { email: e, name: row.name, isAdmin: row.role === "admin" };
  }
  if (!emailSet("ADMIN_EMAILS").has(e)) return null;
  if ((await countActiveAdmins()) > 0) return null;   // bootstrap already used
  console.warn(`[auth] bootstrap admin ${e} admitted via ADMIN_EMAILS — no admin row exists yet`);
  return { email: e, name: null, isAdmin: true };
}

/** Can this Google account sign in at all? Used by the OAuth callback. */
export async function canSignIn(email: string): Promise<boolean> {
  return (await resolveAccess(email)) !== null;
}

// cache() → one access resolution (normally one query) per request.
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const email = await getSessionEmail();
  if (!email) return null;
  let user: CurrentUser | null;
  try {
    user = await resolveAccess(email);
  } catch (err) {
    console.error("[auth] access lookup failed; denying:", err);
    return null;
  }
  if (!user) return null;
  const employeeView = (await cookies()).get(VIEW_COOKIE)?.value === `employee:${user.email}`;
  // A view preference can only narrow access. The database role still decides
  // who may switch back, including after an admin is demoted or removed.
  return { ...user, canSwitchView: user.isAdmin, isAdmin: user.isAdmin && !employeeView };
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

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHmac, timingSafeEqual } from "crypto";
import { getUser } from "@/lib/users";

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

export function allowedEmails(): Set<string> {
  const allowed = emailSet("ALLOWED_EMAILS");
  for (const a of emailSet("ADMIN_EMAILS")) allowed.add(a);
  return allowed;
}

export function isAllowed(email: string): boolean {
  return allowedEmails().has(email.toLowerCase());
}

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

// Role resolution: the app_users row wins when present, otherwise the env allowlist
// decides (so the table can be populated incrementally). Deactivating a user in
// app_users revokes access even if their email is still in ALLOWED_EMAILS.
//
// A DB error must NOT lock everyone out of the dashboard, so it degrades to the env
// allowlist — the same behaviour as before this table existed.
async function resolveRole(email: string): Promise<{ name: string | null; isAdmin: boolean } | null> {
  const envAdmin = emailSet("ADMIN_EMAILS").has(email.toLowerCase());
  try {
    const row = await getUser(email);
    if (row) {
      if (!row.active) return null;
      return { name: row.name, isAdmin: row.role === "admin" };
    }
  } catch (err) {
    console.error("[auth] app_users lookup failed; falling back to env allowlist:", err);
  }
  return isAllowed(email) ? { name: null, isAdmin: envAdmin } : null;
}

// cache() → one resolution (and at most one app_users query) per request.
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const email = await getSessionEmail();
  if (!email) return null;
  // The env allowlist is still the outer gate: an app_users row alone can't grant
  // access to someone who was never allowlisted.
  if (!isAllowed(email)) return null;
  const role = await resolveRole(email);
  if (!role) return null;
  return { email, name: role.name, isAdmin: role.isAdmin };
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

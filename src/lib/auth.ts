import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

// Cookie-based session, same pattern as the reimbursement portal, but the
// allowlist is an env var (ALLOWED_EMAILS) instead of a DB table.

const COOKIE_NAME = "bp_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export type CurrentUser = { email: string; isAdmin: boolean };

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
  c.set(COOKIE_NAME, email, {
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
  return c.get(COOKIE_NAME)?.value ?? null;
}

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const email = await getSessionEmail();
  if (!email || !isAllowed(email)) return null;
  return { email, isAdmin: emailSet("ADMIN_EMAILS").has(email.toLowerCase()) };
});

export async function requireUser(): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) redirect("/");
  return u;
}

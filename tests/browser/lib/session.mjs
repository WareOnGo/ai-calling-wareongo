// Mints the app's session cookie so tests skip Google OAuth entirely.
//
// src/lib/session.ts signs a versioned, expiring base64url JSON payload.
// Reproducing that contract here is the whole
// reason the harness can drive authenticated pages without a browser OAuth dance —
// and it doubles as a live check that the cookie format hasn't changed.
import { createHmac } from "node:crypto";
import { SESSION_SECRET } from "./env.mjs";

export function sessionToken(email) {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ v: 1, email: email.trim().toLowerCase(), iat: now, exp: now + 3600 })).toString("base64url");
  const sig = createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function sessionCookie(email, port) {
  return {
    name: "bp_session",
    value: sessionToken(email),
    domain: "localhost",
    path: "/",
    httpOnly: true,
    secure: false,
    sameSite: "Lax",
    expires: Math.floor(Date.now() / 1000) + 3600,
  };
}

/** A deliberately invalid cookie — used to prove forgery is rejected. */
export function forgedCookie(email) {
  return { ...sessionCookie(email), value: `${email.toLowerCase()}.not-a-real-signature` };
}

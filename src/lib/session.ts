import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}
export function makeToken(email: string, secret: string, now = Math.floor(Date.now() / 1000)): string {
  const payload = Buffer.from(JSON.stringify({ v: 1, email: email.trim().toLowerCase(), iat: now, exp: now + SESSION_MAX_AGE })).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}
export function verifyToken(token: string, secret: string, now = Math.floor(Date.now() / 1000)): string | null {
  try {
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra !== undefined) return null;
    const a = Buffer.from(signature), b = Buffer.from(sign(payload, secret));
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (data.v !== 1 || typeof data.email !== "string" || !data.email.includes("@") ||
        !Number.isInteger(data.iat) || !Number.isInteger(data.exp) || data.iat > now + 60 ||
        data.exp <= now || data.exp <= data.iat || data.exp - data.iat > SESSION_MAX_AGE) return null;
    return data.email.toLowerCase();
  } catch { return null; }
}

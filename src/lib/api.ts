import { NextResponse } from "next/server";
import { z } from "zod";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public field?: string) { super(message); }
}

// Large enough for the supported 20,000 selected UUIDs plus assignment options.
// Count actual bytes as well as Content-Length: chunked or dishonest requests
// must not bypass the limit. This applies to interactive dashboard mutations.
export const MAX_JSON_BODY_BYTES = 1024 * 1024;
export async function jsonBody<S extends z.ZodType>(req: Request, schema: S, { allowEmpty = false } = {}): Promise<z.output<S>> {
  const length = Number(req.headers.get('content-length'));
  if (length > MAX_JSON_BODY_BYTES) {
    void req.body?.cancel().catch(() => {});
    throw new ApiError(413, 'Request body is too large');
  }
  const reader = req.body?.getReader();
  let content = new Uint8Array(0);
  let bytes = 0;
  try {
    if (reader) while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_JSON_BODY_BYTES) {
        void reader.cancel().catch(() => {});
        throw new ApiError(413, 'Request body is too large');
      }
      // Grow geometrically: retaining arbitrarily many tiny chunks can itself
      // use excessive memory, even when the total byte count is small.
      if (bytes > content.length) {
        const next = new Uint8Array(Math.min(MAX_JSON_BODY_BYTES, Math.max(bytes, content.length * 2, 8192)));
        next.set(content);content = next;
      }
      content.set(value, bytes - value.byteLength);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'Invalid JSON body');
  } finally { reader?.releaseLock(); }
  if (!bytes && !allowEmpty) throw new ApiError(400, 'Invalid JSON body');
  let body: unknown;
  try { body = bytes ? JSON.parse(new TextDecoder().decode(content.subarray(0, bytes))) : {}; }
  catch { throw new ApiError(400, 'Invalid JSON body'); }
  return schema.parse(body);
}

export function apiError(error: unknown): NextResponse {
  if (error instanceof ApiError) return NextResponse.json({ error: error.message, code: error.code, field: error.field }, { status: error.status });
  if (error instanceof z.ZodError) {
    const messages = error.issues.slice(0, 8).map(issue => `${issue.path.join('.') || 'body'}: ${issue.message}`.slice(0, 512));
    if (error.issues.length > 8) messages.push('Additional validation errors omitted');
    return NextResponse.json({ error: messages.join('; ') }, { status: 400 });
  }
  if (error && typeof error === "object" && "code" in error && error.code === "23505") {
    return NextResponse.json({ error: "This item has changed or already has an owner. Refresh before trying again." }, { status: 409 });
  }
  if (error && typeof error === 'object' && 'code' in error && error.code === '23514' && 'detail' in error) {
    try { const issue=JSON.parse(String(error.detail));
      if (issue?.code === 'WAREHOUSE_ALREADY_ADDED') return NextResponse.json({ error: "This number has a warehouse already added to DB and cannot be assigned, reopened, or queued for calling.", code: issue.code }, { status: 409 });
 if(issue.code && issue.field && issue.message) return NextResponse.json({error:issue.message,code:issue.code,field:issue.field},{status:422}); } catch { /* Not a structured application constraint. */ }
  }
  console.error("[api] request failed", error);
  return NextResponse.json({ error: "Request failed. Please retry." }, { status: 500 });
}

// Preserve the existing PostgreSQL UUID / provider-ID contract: Zod 4's uuid()
// rejects retained identifiers whose version or variant bits are nonstandard.
export const uuid = z.guid().transform(v => v.toLowerCase());
export const bigintId = z.string().regex(/^[1-9]\d{0,18}$/).pipe(z.string().refine(v => BigInt(v) <= 9223372036854775807n, "Invalid ID"));
export const nullableText = z.string().max(10000).nullable().transform(v => v === "" ? null : v);
export const revision = z.number().int().nonnegative();
export const selectedIds = z.array(uuid).min(1).max(20000).transform(ids => [...new Set(ids)]);

export function workerAuthorized(req: Request): boolean {
  const secret = process.env.PROCESS_SECRET;
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? new URL(req.url).searchParams.get("token");
  return !!secret && token === secret;
}

export function envInt(key: string, fallback: number, max: number): number {
  const value = Number(process.env[key] ?? fallback);
  return Number.isInteger(value) && value > 0 ? Math.min(value, max) : fallback;
}

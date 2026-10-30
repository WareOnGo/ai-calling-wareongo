import { NextResponse } from "next/server";
import { z } from "zod";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public field?: string) { super(message); }
}

export async function jsonBody<S extends z.ZodTypeAny>(req: Request, schema: S): Promise<z.output<S>> {
  let body: unknown;
  try { body = await req.json(); } catch { throw new ApiError(400, "Invalid JSON body"); }
  return schema.parse(body);
}

export function apiError(error: unknown): NextResponse {
  if (error instanceof ApiError) return NextResponse.json({ error: error.message, code: error.code, field: error.field }, { status: error.status });
  if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(i => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") }, { status: 400 });
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

export const uuid = z.string().uuid().transform(v => v.toLowerCase());
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

import { NextResponse } from "next/server";
import { z } from "zod";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function jsonBody<S extends z.ZodTypeAny>(req: Request, schema: S): Promise<z.output<S>> {
  let body: unknown;
  try { body = await req.json(); } catch { throw new ApiError(400, "Invalid JSON body"); }
  return schema.parse(body);
}

export function apiError(error: unknown): NextResponse {
  if (error instanceof ApiError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(i => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") }, { status: 400 });
  if (error && typeof error === "object" && "code" in error && error.code === "23505") {
    return NextResponse.json({ error: "This item has changed or already has an owner. Refresh before trying again." }, { status: 409 });
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

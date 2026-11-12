import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { apiError, bigintId, jsonBody, nullableText, revision } from "@/lib/api";
import { updateTaskNotes } from "@/lib/board-moves";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ revision, remarks: nullableText }).strict();

// Notes are the task's remarks field, so other pages keep reading the same value.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const id = bigintId.parse((await params).id);
    const body = await jsonBody(req, schema);
    return NextResponse.json(await updateTaskNotes(user, id, { revision: body.revision, remarks: body.remarks?.trim() || null }, req.nextUrl.searchParams.get("employee")));
  } catch (error) { return apiError(error); }
}

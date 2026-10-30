import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { updateMyWorkAssignment } from "@/lib/employee-assignments";
import { jsonBody, apiError, bigintId, nullableText, revision } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const patchSchema = z.object({
  outcome: z.union([z.enum(["Available", "Unavailable", "Unclear", ""]), z.null()]).transform(v => v || null).optional(),
  remarks: nullableText.optional(), state: z.enum(["open", "done"]).optional(),
  added_to_db: z.boolean().optional(), wh_id: nullableText.optional(), revision,
}).strict().refine(v => Object.keys(v).length > 1, "No editable fields provided");

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const id = bigintId.parse((await params).id);
    const body = await jsonBody(req, patchSchema);
    const { added_to_db, wh_id, ...rest } = body;
    const row = await updateMyWorkAssignment(id, user, { ...rest,
      ...(added_to_db !== undefined ? { addedToDb: added_to_db } : {}),
      ...(wh_id !== undefined ? { whId: wh_id } : {}),
    });
    return NextResponse.json({ ok: true, ...row });
  } catch (error) { return apiError(error); }
}

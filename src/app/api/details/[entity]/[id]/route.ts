import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCallDetailsByIds } from "@/lib/calls";
import { getRawRecordsByIds, getRelatedListings } from "@/lib/raw";
import { manualHistory } from "@/lib/manual-attempts";
import { listAssignments } from "@/lib/assignments";

export async function GET(_req: Request, { params }: { params: Promise<{ entity: string; id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { entity, id } = await params;
  if (!['call', 'record'].includes(entity) || (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) return NextResponse.json({ error: "not found" }, { status: 404 });
  const rows = entity === 'call' ? await getCallDetailsByIds(user, [id]) : await getRawRecordsByIds(user, [id]);
  if (!rows.length) return NextResponse.json({ error: "not found" }, { status: 404 });
  const history = await listAssignments(user, { entity_id: id, entity_type: entity, assignee: user.isAdmin ? undefined : user.email, pageSize: 50 });
  const manual=await manualHistory(user,entity as "call"|"record",id,Number(new URL(_req.url).searchParams.get("manual_page")||1));
  const related = await getRelatedListings(user, entity as "call" | "record", id);
  return NextResponse.json({ manual,row: rows[0], history: history.rows, historyTotal: history.total,
    relatedListings: related.slice(0,100), relatedListingsCapped: related.length > 100 });
}

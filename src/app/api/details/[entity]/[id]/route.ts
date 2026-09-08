import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCallsForExport } from "@/lib/calls";
import { getRawRecordsByIds } from "@/lib/raw";
import { listAssignments } from "@/lib/assignments";

export async function GET(_req: Request, { params }: { params: Promise<{ entity: string; id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { entity, id } = await params;
  if (!['call', 'record'].includes(entity) || (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) return NextResponse.json({ error: "not found" }, { status: 404 });
  const rows = entity === 'call' ? await getCallsForExport(user, { ids: [id] }) : await getRawRecordsByIds(user, [id]);
  if (!rows.length) return NextResponse.json({ error: "not found" }, { status: 404 });
  const history = await listAssignments({ entity_id: id, entity_type: entity, assignee: user.isAdmin ? undefined : user.email, pageSize: 50 });
  return NextResponse.json({ row: rows[0], history: history.rows, historyTotal: history.total });
}

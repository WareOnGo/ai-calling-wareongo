import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCallDetailsByIds } from "@/lib/calls";
import { getRawRecordsByIds, getRelatedListings } from "@/lib/raw";
import { manualHistory } from "@/lib/manual-attempts";
import { listAssignments } from "@/lib/assignments";
import { recordAccess } from "@/lib/record-access";
import { apiError, ApiError } from "@/lib/api";

export async function GET(_req: Request, { params }: { params: Promise<{ entity: string; id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { entity, id } = await params;
  if (!['call', 'record'].includes(entity) || (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    const kind = entity as 'call' | 'record', search = new URL(_req.url).searchParams;
    const section = search.get('section') || 'all';
    if (!['all', 'overview', 'manual'].includes(section)) throw new ApiError(400, 'Invalid details section');
    if (section === 'manual') await recordAccess(user, kind, id);
    // Each reader enforces its own scope. Related independent reads can overlap;
    // a page change in Manual activity never downloads the record evidence again.
    const [rows, related, history, manual] = await Promise.all([
      section === 'manual' ? null : kind === 'call' ? getCallDetailsByIds(user, [id]) : getRawRecordsByIds(user, [id]),
      section === 'manual' ? null : getRelatedListings(user, kind, id),
      section === 'overview' ? null : listAssignments(user, { entity_id: id, entity_type: kind, assignee: user.isAdmin ? undefined : user.email, pageSize: 50 }),
      section === 'overview' ? null : manualHistory(user, kind, id, Number(search.get('manual_page') || 1)),
    ]);
    if (rows && !rows.length) throw new ApiError(404, 'Not found');
    return NextResponse.json({
      ...(rows && related ? { row: rows[0], relatedListings: related.slice(0,100), relatedListingsCapped: related.length > 100 } : {}),
      ...(history && manual ? { manual, history: history.rows, historyTotal: history.total } : {}),
    });
  } catch (error) { return apiError(error); }
}

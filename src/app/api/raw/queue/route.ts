import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getRawQueueRows, type RawFilters } from "@/lib/raw";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Returns every matching raw record (with a phone) for the current filters — the
// "select all across pages" source for the queue-for-calling flow. Mirrors the
// filter parsing in dashboard/raw/page.tsx; dedup-by-number happens client-side.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const filters: RawFilters = {
    q: sp.get("q") ?? undefined,
    source: sp.get("source") ?? undefined,
    state: sp.get("state") ?? undefined,
    city: sp.get("city") ?? undefined,
    contact: sp.get("contact") ?? undefined,
    called: sp.get("called") ?? undefined,
    last_result: sp.get("last_result") ?? undefined,
    min_area: sp.get("min_area") ? Number(sp.get("min_area")) : undefined,
    max_area: sp.get("max_area") ? Number(sp.get("max_area")) : undefined,
    has_phone: sp.get("has_phone") === "1",
  };

  const { rows, capped } = await getRawQueueRows(filters);
  return NextResponse.json({ rows, capped });
}

import { toRawFilters } from "@/lib/filters";
import { apiError } from "@/lib/api";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { getRawQueueRows } from "@/lib/raw";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Returns every matching raw record (with a phone) for the current filters — the
// "select all across pages" source for the queue-for-calling flow. Mirrors the
// filter parsing in dashboard/raw/page.tsx; dedup-by-number happens client-side.
//
// Admin only: this feeds Bolna dispatch, which spends money and rings real phones.
export async function GET(req: NextRequest) {
  const user = await getCurrentAdmin();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  try {
    return NextResponse.json(await getRawQueueRows(user, toRawFilters(Object.fromEntries(req.nextUrl.searchParams))));
  } catch (error) { return apiError(error); }
}

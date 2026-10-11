import {z} from "zod";
import { searchValues } from "@/lib/filter-values";
import { toRawFilters } from "@/lib/filters";
import { apiError, jsonBody, selectedIds } from "@/lib/api";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { getRawQueueRows, getRawQueueRowsByIds } from "@/lib/raw";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Returns every matching raw record (with a phone) for the current filters — the
// "select all across pages" source for the queue-for-calling flow. Mirrors the
// filter parsing in dashboard/raw/page.tsx. Preview and dispatch share contact grouping.
//
// Admin only: this feeds Bolna dispatch, which spends money and rings real phones.
export async function GET(req: NextRequest) {
  const user = await getCurrentAdmin();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  try {
    return NextResponse.json(await getRawQueueRows(user, toRawFilters(searchValues(req.nextUrl.searchParams))));
  } catch (error) { return apiError(error); }
}

export async function POST(req:NextRequest){
 const user=await getCurrentAdmin();if(!user)return NextResponse.json({error:'forbidden'},{status:403});
 try{const {ids}=await jsonBody(req,z.object({ids:selectedIds}).strict());const rows=await getRawQueueRowsByIds(user,ids);return NextResponse.json({rows,capped:false,total:rows.length,skippedNoPhone:rows.filter(r=>!r.contact).length});}catch(error){return apiError(error);}
}

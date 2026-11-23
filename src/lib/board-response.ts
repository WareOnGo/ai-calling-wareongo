import { NextRequest, NextResponse } from "next/server";
import type { CurrentUser } from "./auth";
import { loadBoardSnapshot, ownWork } from "./board";
import { parseBoardFilters, parseColumnLimits } from "./board-filters";
import { searchValues } from "./filter-values";

/** Called only after the authorized write commits, with no allocation/row locks held. */
export async function boardResponse(req: NextRequest, user: CurrentUser, result: object) {
  const view = req.headers.get("x-board-view");
  if (view === null) return NextResponse.json(result);
  const boardSavedAt = new Date().toISOString();
  // The header supplies presentation criteria only. Ownership comes from the
  // authenticated actor and the same employee parameter validated by the write.
  const employee = req.nextUrl.searchParams.get("employee")?.trim().toLowerCase();
  const scope = ownWork({ ...user, email: user.isAdmin && employee ? employee : user.email });
  const params = searchValues(new URLSearchParams(view));
  try {
    const boardView = await loadBoardSnapshot(scope, parseBoardFilters(params, scope), parseColumnLimits(params));
    return NextResponse.json({ ...result, boardView, boardSavedAt }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // A failed read must never report a committed write as failed and invite a
    // duplicate submission. The client keeps the save and reloads before editing.
    console.error("[board] Saved change, but could not read the updated board");
    return NextResponse.json({ ...result, boardSavedAt, boardRefreshFailed: true }, { headers: { "Cache-Control": "no-store" } });
  }
}

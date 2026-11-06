import { requireUser } from "@/lib/auth";
import type { SearchValues } from "@/lib/filter-values";
import { boardFilterOptions, loadBoard, loadJunkProposals, ownWork } from "@/lib/board";
import { boardSearchValues, parseBoardFilters, parseColumnLimits } from "@/lib/board-filters";
import { BoardHeader } from "./BoardHeader";
import { BoardFilters } from "./BoardFilters";
import { BoardView } from "./BoardView";

export const dynamic = "force-dynamic";

// A personal view like My Work: everyone, admins included, sees their own work here.
// Filters and column sizes live in the URL, so a board view can be shared and reloaded.
export default async function BoardPage({ searchParams }: { searchParams: Promise<SearchValues> }) {
  const user = await requireUser();
  const me = ownWork(user);
  const params = await searchParams;
  const filters = parseBoardFilters(params, me);
  const limits = parseColumnLimits(params);
  const [board, options, proposals] = await Promise.all([loadBoard(me, filters, limits), boardFilterOptions(me), loadJunkProposals(me, filters)]);
  return <>
    <BoardHeader view="board" isAdmin={user.isAdmin} status={<span className="board-summary">{board.total} {board.total === 1 ? "card" : "cards"}</span>} />
    <BoardFilters applied={boardSearchValues(filters)} options={options} />
    {/* Manual and Callyzer call records are for admins; employees (and Employee view) see AI calls only. */}
    <BoardView board={board} proposals={proposals} filters={filters} limits={limits} showCalls={user.isAdmin} />
  </>;
}

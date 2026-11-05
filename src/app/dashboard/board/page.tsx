import { requireUser } from "@/lib/auth";
import type { SearchValues } from "@/lib/filter-values";
import { boardFilterOptions, loadBoard } from "@/lib/board";
import { boardSearchValues, parseBoardFilters, parseColumnLimits } from "@/lib/board-filters";
import { RecordsHeader } from "../RecordsHeader";
import { Freshness } from "../DashboardUI";
import { BoardFilters } from "./BoardFilters";
import { BoardView } from "./BoardView";

export const dynamic = "force-dynamic";

// Filters and column sizes live in the URL, so a board view can be shared and reloaded.
export default async function BoardPage({ searchParams }: { searchParams: Promise<SearchValues> }) {
  const user = await requireUser();
  const params = await searchParams;
  const filters = parseBoardFilters(params, user);
  const limits = parseColumnLimits(params);
  const [board, options] = await Promise.all([loadBoard(user, filters, limits), boardFilterOptions(user)]);
  return <>
    <RecordsHeader title="Board" status={<span className="board-summary">{board.total} {board.total === 1 ? "card" : "cards"}</span>}
      actions={<Freshness updatedAt={new Date().toISOString()} />} />
    <BoardFilters applied={boardSearchValues(filters)} options={options} isAdmin={user.isAdmin} />
    <BoardView board={board} filters={filters} limits={limits} isAdmin={user.isAdmin} />
  </>;
}

import { requireUser } from "@/lib/auth";
import { firstValue, type SearchValues } from "@/lib/filter-values";
import { employeeWorkPerspective } from "@/lib/employee-work-perspective";
import { listAssignees } from "@/lib/users";
import { notFound } from "next/navigation";
import { boardFilterOptions, loadBoardSnapshot, ownWork } from "@/lib/board";
import { parseBoardFilters, parseColumnLimits } from "@/lib/board-filters";
import { BoardView } from "./BoardView";

export const dynamic = "force-dynamic";

// Own work by default; admin changes to employee work require confirmation per entry.
// Filters and column sizes live in the URL, so a board view can be shared and reloaded.
export default async function BoardPage({ searchParams }: { searchParams: Promise<SearchValues> }) {
  const user = await requireUser();
  const params = await searchParams;
  const [viewer, employees] = await Promise.all([
    employeeWorkPerspective(user, firstValue(params.employee)),
    user.isAdmin ? listAssignees() : undefined,
  ]);
  if (!viewer) notFound();
  const me = ownWork(viewer);
  const filters = parseBoardFilters(params, me);
  if (viewer.email !== user.email) filters.employee = viewer.email;
  const limits = parseColumnLimits(params);
  const updatedAt = new Date().toISOString();
  const [data, options] = await Promise.all([loadBoardSnapshot(me, filters, limits), boardFilterOptions(me)]);
  return <>
    {/* Manual and Callyzer call records are for admins; employees (and Employee view) see AI calls only. */}
    <BoardView key={viewer.email} data={data} updatedAt={updatedAt} filters={filters} limits={limits} showCalls={viewer.isAdmin}
      options={options} employees={employees?.filter(person => person.email !== user.email).map(({ email, name }) => ({ email, name }))} />
  </>;
}

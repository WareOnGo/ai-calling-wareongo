import { requireUser } from "@/lib/auth";
import { personalAssigners, personalTotals, personalWork } from "@/lib/personal-work";
import { hasWorkCriteria, parseWorkFilters } from "@/lib/work-filters";
import { WorkLists } from "./WorkLists";

export const dynamic = "force-dynamic";
export default async function MyWork({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const filters = parseWorkFilters(sp);
  const totalRequest = personalTotals(user.email);
  const [records, calls, totals, matchingTotals, assigners] = await Promise.all([
    personalWork(user, "record", filters, Number(sp.records_page || 1)),
    personalWork(user, "call", filters, Number(sp.calls_page || 1)),
    totalRequest,
    hasWorkCriteria(filters) ? personalTotals(user.email, filters) : totalRequest,
    personalAssigners(user.email),
  ]);
  return <WorkLists key={`${JSON.stringify(filters)}:${records.page}:${calls.page}`} records={records} calls={calls} totals={totals} matchingTotals={matchingTotals} filters={filters} assigners={assigners} updatedAt={new Date().toISOString()} />;
}

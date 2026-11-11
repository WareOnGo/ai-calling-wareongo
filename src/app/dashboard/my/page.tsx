import { requireUser } from "@/lib/auth";
import { personalAssigners, personalTotals, personalWork } from "@/lib/employee-work";
import { hasWorkCriteria, parseWorkFilters } from "@/lib/employee-work-filters";
import { employeeWorkPerspective } from "@/lib/employee-work-perspective";
import { listAssignees } from "@/lib/users";
import { notFound } from "next/navigation";
import { WorkLists } from "./WorkLists";

export const dynamic = "force-dynamic";
export default async function MyWork({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const filters = parseWorkFilters(sp);
  const [viewer, employees] = await Promise.all([
    employeeWorkPerspective(user, filters.employee),
    user.isAdmin ? listAssignees() : undefined,
  ]);
  if (!viewer) notFound();
  const viewingEmployee = viewer.email !== user.email ? { email: viewer.email, name: viewer.name } : undefined;
  // Only the server-authorized perspective is passed to filters and links.
  if (viewingEmployee) filters.employee = viewer.email;
  else delete filters.employee;
  const totalRequest = personalTotals(viewer.email);
  const [records, calls, totals, matchingTotals, assigners] = await Promise.all([
    personalWork(viewer, "record", filters, Number(sp.records_page || 1)),
    personalWork(viewer, "call", filters, Number(sp.calls_page || 1)),
    totalRequest,
    hasWorkCriteria(filters) ? personalTotals(viewer.email, filters) : totalRequest,
    personalAssigners(viewer.email),
  ]);
  return <WorkLists key={JSON.stringify(filters)} records={records} calls={calls} totals={totals} matchingTotals={matchingTotals} filters={filters} assigners={assigners} employees={employees?.filter(person => person.email !== user.email).map(({ email, name }) => ({ email, name }))} viewingEmployee={viewingEmployee} updatedAt={new Date().toISOString()} />;
}

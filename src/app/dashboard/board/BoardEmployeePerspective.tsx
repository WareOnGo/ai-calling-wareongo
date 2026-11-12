"use client";

import { boardHref, type BoardFilters } from "@/lib/board-filters";
import { useDashboardUI } from "../DashboardUI";
import type { WorkEmployee } from "../my/EmployeePerspective";

export function BoardEmployeePerspective({ employees, filters }: {
  employees: WorkEmployee[]; filters: BoardFilters;
}) {
  const { navigate, pending } = useDashboardUI();
  const employee = employees.find(person => person.email === filters.employee);
  return <div className="board-perspective" aria-busy={pending}>
    <label htmlFor="board-employee">View work as</label>
    <select id="board-employee" value={filters.employee || ""} disabled={pending}
      aria-describedby={filters.employee ? "board-perspective-note" : undefined}
      onChange={event => navigate(boardHref({ ...filters, employee: event.target.value || undefined }))}>
      <option value="">My work (me)</option>
      {employees.map(person => <option key={person.email} value={person.email}>{person.name ? `${person.name} (${person.email})` : person.email}</option>)}
    </select>
    {employee && <span id="board-perspective-note">Confirm once per entry</span>}
  </div>;
}

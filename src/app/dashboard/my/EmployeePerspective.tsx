"use client";

import { workHref, type WorkFilters } from "@/lib/employee-work-filters";
import { useDashboardUI } from "../DashboardUI";

export type WorkEmployee = { email: string; name: string | null };

export function EmployeePerspective({ employees, filters, loading = false }: {
  employees: WorkEmployee[]; filters: WorkFilters; loading?: boolean;
}) {
  const { navigate, pending } = useDashboardUI();
  return <div className="work-perspective" aria-busy={pending || loading}>
    <label htmlFor="work-employee">View work as</label>
    <select id="work-employee" className="field" value={filters.employee || ""} disabled={pending || loading}
      aria-describedby={filters.employee ? "work-perspective-note" : undefined}
      onChange={event => navigate(workHref(filters, { employee: event.target.value || undefined }))}>
      <option value="">My work (me)</option>
      {loading && filters.employee && <option value={filters.employee}>{filters.employee}</option>}
      {employees.map(person => <option key={person.email} value={person.email}>{person.name ? `${person.name} (${person.email})` : person.email}</option>)}
    </select>
    {filters.employee && <span id="work-perspective-note">Read-only employee view</span>}
  </div>;
}

export type WorkFilters = {
  q?: string; view?: "open" | "done"; type?: "record" | "call"; outcome?: "none" | "Available" | "Unavailable" | "Unclear";
  city?: string; assigned_by?: string; added_to_db?: "yes" | "no"; sort?: "oldest" | "name";
};

export const WORK_FILTER_LABELS: Record<string, string> = {
  q: "Search", type: "Work type", outcome: "Result", city: "City", assigned_by: "Assigned by", added_to_db: "In DB", sort: "Sort",
};
export const WORK_SORT_LABELS = { newest: "Newest assigned", oldest: "Oldest assigned", name: "Name A–Z" };

export function parseWorkFilters(params: Record<string, string | string[] | undefined>): WorkFilters {
  const value = (key: string) => { const raw = params[key]; return (Array.isArray(raw) ? raw[0] : raw)?.trim() || undefined; };
  const filters: WorkFilters = {};
  for (const key of ["q", "city", "assigned_by"] as const) if (value(key)) filters[key] = value(key);
  const options = { view: ["open", "done"], type: ["record", "call"], outcome: ["none", "Available", "Unavailable", "Unclear"], added_to_db: ["yes", "no"], sort: ["oldest", "name"] };
  for (const [key, allowed] of Object.entries(options)) {
    const selected = value(key);
    if (selected && allowed.includes(selected)) Object.assign(filters, { [key]: selected });
  }
  return filters;
}

export function workHref(filters: WorkFilters, override: Record<string, string | undefined> = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, ...override })) if (value) params.set(key, value);
  return `/dashboard/my${params.size ? `?${params}` : ""}`;
}

export function hasWorkCriteria(filters: WorkFilters) {
  return Object.entries(filters).some(([key, value]) => value && key !== "view" && key !== "sort");
}

export function workFilterValue(key: string, value: string) {
  if (key === "type") return value === "record" ? "Listings" : "AI follow-ups";
  if (key === "outcome" && value === "none") return "Not called yet";
  if (key === "added_to_db") return value === "yes" ? "Added" : "Not added";
  if (key === "sort") return WORK_SORT_LABELS[value as keyof typeof WORK_SORT_LABELS] || value;
  return value;
}

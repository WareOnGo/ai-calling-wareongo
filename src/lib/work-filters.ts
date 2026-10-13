export type WorkFilters = {
  q?: string; view?: "open" | "done"; type?: "record" | "call"; outcome?: "none" | "Available" | "Unavailable" | "Unclear";
  ai_result?: "none" | "Available" | "Unavailable" | "Unclear" | "dead number - do not call";
  wh_id?: string; has_notes?: "yes" | "no"; has_manual_calls?: "yes" | "no"; date_from?: string; date_to?: string;
  follow_up?: "pending" | "due";
  city?: string; assigned_by?: string; added_to_db?: "yes" | "no"; sort?: "oldest" | "name";
};

export const WORK_FILTER_LABELS: Record<string, string> = {
  ai_result:"AI result",wh_id:"WH ID",has_notes:"Manual notes",has_manual_calls:"Manual calls logged",date_from:"Assigned from",date_to:"Assigned to date",follow_up:"Follow-up",q: "Search", type: "Work type", outcome: "Manual result", city: "City", assigned_by: "Assigned by", added_to_db: "In DB", sort: "Sort",
};
export const WORK_SORT_LABELS = { newest: "Newest assigned", oldest: "Oldest assigned", name: "Name A–Z" };

export function parseWorkFilters(params: Record<string, string | string[] | undefined>): WorkFilters {
  const value = (key: string) => { const raw = params[key]; return (Array.isArray(raw) ? raw[0] : raw)?.trim() || undefined; };
  const filters: WorkFilters = {};
  for (const key of ["q", "city", "assigned_by", "wh_id", "date_from", "date_to"] as const) if (value(key)) filters[key] = value(key);
  const options = { ai_result:["none","Available","Unavailable","Unclear","dead number - do not call"],has_notes:["yes","no"],has_manual_calls:["yes","no"],follow_up:["pending","due"],view: ["open", "done"], type: ["record", "call"], outcome: ["none", "Available", "Unavailable", "Unclear"], added_to_db: ["yes", "no"], sort: ["oldest", "name"] };
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
  if (key === "ai_result" && value === "none") return "No AI result";
  if (["has_notes", "has_manual_calls"].includes(key)) return value === "yes" ? "Yes" : "No";
  if (key === "outcome" && value === "none") return "No manual result";
  if (key === "added_to_db") return value === "yes" ? "Added" : "Not added";
  if (key === "sort") return WORK_SORT_LABELS[value as keyof typeof WORK_SORT_LABELS] || value;
  return value;
}

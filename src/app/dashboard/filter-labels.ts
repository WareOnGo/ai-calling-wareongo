export const FILTER_LABELS: Record<string, string> = { q: "Search", availability: "Availability", call_type: "Direction", source: "Source", state: "State", city: "City", contact: "Contact", agent_id: "Agent", status: "Status", date_from: "From", date_to: "To", needs_review: "Needs review", assignee: "Assigned to", called: "Called", last_result: "Last result", has_phone: "Has phone", min_area: "Min sqft", max_area: "Max sqft", type: "Channel", outcome: "Result" };

export function filterLabel(key: string, path: string) {
  return path === "/dashboard/assignments" && key === "state" ? "Status" : FILTER_LABELS[key];
}

export function filterValue(key: string, value: string) {
  if (value === "none") return key === "outcome" ? "No result yet" : "Unassigned";
  if (key === "state" && value === "dropped") return "Unassigned";
  return value === "1" && key !== "q" ? "Yes" : value;
}

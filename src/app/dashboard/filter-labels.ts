export const FILTER_LABELS: Record<string, string> = { include_blocked:"Balance-blocked included",warehouse_type:"Warehouse type",rent_mentioned:"Rent mentioned",onboarded:"Staff onboarded",manual_outcome:"Manual result",area_basis:"Area basis",batch_id:"Assignment batch",quality_review:"Completion review",follow_up:"Follow-up",q: "Search", availability: "Availability", call_type: "Direction", source: "Source", state: "State", city: "City", contact: "Contact", agent_id: "Agent", status: "Status", date_from: "From", date_to: "To", needs_review: "Needs AI review", assignee: "Assigned to", assignment_state: "Ownership", called: "Called", last_result: "Last result", has_phone: "Has phone", min_area: "Min sqft", max_area: "Max sqft", type: "Channel", outcome: "Result" };

export function filterLabel(key: string, path: string) {
  return path === "/dashboard/assignments" && key === "state" ? "Status" : FILTER_LABELS[key];
}

export function filterValue(key: string, value: string) {
  if (value === "none") return ["outcome","manual_outcome","availability","last_result"].includes(key) ? "No result yet" : "Unassigned now";
  if (key === "state" && value === "dropped") return "Unassigned";
  return value === "1" && key !== "q" ? "Yes" : value;
}

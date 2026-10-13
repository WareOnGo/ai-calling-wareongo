export const FILTER_LABELS: Record<string, string> = { ai_result:"AI result",added_to_db:"Added to DB",wh_id:"WH ID",has_notes:"Manual notes",has_manual_calls:"Manual calls logged",has_recording:"Recording",has_transcript:"Transcript",assigned_by:"Assigned by",sort:"Sort",caller:"Caller",agent:"Agent ID",dispatch_id:"Dispatch ID",origin:"Work type",language:"Language",has_attempts:"Recorded attempts",access:"Access",role:"Role", include_blocked:"Balance-blocked included",warehouse_type:"Warehouse type",rent_mentioned:"Rent mentioned",onboarded:"Staff onboarded",manual_outcome:"Manual result",area_basis:"Area basis",batch_id:"Assignment batch",quality_review:"Completion review",follow_up:"Follow-up",q: "Search", availability: "AI result", call_type: "Direction", source: "Source", state: "State", city: "City", contact: "Contact", agent_id: "Agent", status: "Status", date_from: "From", date_to: "To", needs_review: "Needs AI review", assignee: "Assigned to", assignment_state: "Ownership", called: "Called", last_result: "Latest AI result", has_phone: "Has phone", min_area: "Min sqft", max_area: "Max sqft", type: "Channel", outcome: "Manual result" };

export function filterLabel(key: string, path: string) {
  if (path === "/dashboard/assignments" && key === "state") return "Status";
  if (path === "/dashboard/assignments" && key === "date_from") return "Assigned from";
  if (path === "/dashboard/assignments" && key === "date_to") return "Assigned to date";
  if (path === "/dashboard/raw" && key === "ai_result") return "AI history result";
  if (path.startsWith("/dashboard/batches") && key === "state") return "Status";
  return FILTER_LABELS[key];
}

export function filterValue(key: string, value: string) {
  if (key === "follow_up") return ({pending:"Pending follow-up",due:"Follow-up due"} as Record<string,string>)[value] || value;
  if (value === "none") return ["outcome","manual_outcome","availability","last_result","ai_result"].includes(key) ? "No result yet" : "Unassigned now";
  if (key === "state" && value === "dropped") return "Unassigned";
  if (["added_to_db", "onboarded"].includes(key)) return value === "yes" ? "Added" : "Not added";
  if (["has_notes", "has_manual_calls", "has_recording", "has_transcript", "has_attempts", "has_phone"].includes(key)) return ["1", "yes", "true"].includes(value) ? "Yes" : "No";
  if (key === "sort") return value === "name" ? "Name A–Z" : "Oldest first";
  if (key === "type" || key === "origin") return value === "record" ? "Listings" : "AI call follow-ups";
  if (key === "area_basis") return ({source:"Source listing",built_up:"Built-up",carpet:"Carpet"} as Record<string,string>)[value] || value;
  return value === "1" && key !== "q" ? "Yes" : value;
}

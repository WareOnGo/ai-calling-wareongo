import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { callsExportQuery, type CallRow } from "@/lib/calls";
import { agentLabel } from "@/lib/agents";
import { toCallFilters } from "@/lib/filters";
import { apiError } from "@/lib/api";
import { exportInput, csvResponse } from "@/lib/export";


export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CSV columns: label + how to pull the value from a row. Mirrors the dashboard grid
// (representative matched listing + match count); pagination-independent.
const COLUMNS: { label: string; get: (r: CallRow) => unknown }[] = [
  { label: "Agent", get: (r) => agentLabel(r.agent_id) },
  { label: "Agent ID", get: (r) => r.agent_id },
  { label: "When", get: (r) => r.call_created_at },
  { label: "Direction", get: (r) => (r.call_type === "inbound" ? "Inbound" : "Outbound") },
  { label: "Number", get: (r) => (r.call_type === "inbound" ? r.from_number : r.to_number) },
  { label: "Owner", get: (r) => r.owner_name },
  { label: "Area", get: (r) => r.db_area },
  { label: "Availability", get: (r) => r.availability },
  { label: "Built-up sqft", get: (r) => r.built_up_area_sqft },
  { label: "Carpet sqft", get: (r) => r.carpet_area_sqft },
  { label: "Rent", get: (r) => r.expected_rent },
  { label: "Status", get: (r) => r.status },
  { label: "Notes", get: (r) => r.notes },
  { label: "Transcript", get: (r) => r.transcript },
  { label: "Recording", get: (r) => r.recording_url },
  { label: "DB Source", get: (r) => r.raw_source },
  { label: "DB Owner", get: (r) => r.raw_owner_name },
  { label: "DB Type", get: (r) => r.raw_warehouse_type },
  { label: "DB City", get: (r) => r.raw_city },
  { label: "DB State", get: (r) => r.raw_state },
  { label: "DB Sqft", get: (r) => r.raw_area_sqft },
  { label: "DB Contact", get: (r) => r.raw_contact_type },
  { label: "All Sources", get: (r) => r.raw_sources },
  { label: "DB Matches", get: (r) => r.raw_match_count },
  { label: "Assigned To", get: (r) => r.assigned_to },
  { label: "Human Result", get: (r) => r.assignment_outcome },
  { label: "Human Remarks", get: (r) => r.assignment_remarks },
  { label: "Call Status", get: (r) => r.call_status },
  { label: "Called By", get: (r) => r.called_by },
  { label: "Added to DB", get: (r) => (r.added_to_db ? "yes" : "no") },
  { label: "WH ID", get: (r) => r.wh_id },
];

export const maxDuration = 300;
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const { ids, filters } = await exportInput(req);
    const spec = callsExportQuery(user, ids ? { ids } : toCallFilters(filters));
    return await csvResponse(spec, COLUMNS, `bolna-calls-${new Date().toISOString().slice(0, 10)}.csv`);
  } catch (error) { return apiError(error); }
}
export const POST = GET;

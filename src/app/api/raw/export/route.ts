import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { rawExportQuery, type RawExportRow } from "@/lib/raw";
import { toRawFilters } from "@/lib/filters";
import { apiError } from "@/lib/api";
import { exportInput, csvResponse } from "@/lib/export";


export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CSV columns for the raw-dataset export. Mirrors the visible grid (rent/type stay
// hidden per the dashboard) plus a few useful extras (first name, phone count, email).
// The call columns are prefixed "AI …" — those calls were placed by the AI agent (not a
// human POC), and the results are its transcript / LLM inference. The full source
// metadata JSON is included as a trailing column.
const COLUMNS: { label: string; get: (r: RawExportRow) => unknown }[] = [
  { label: "Source", get: (r) => r.source },
  { label: "Record ID", get: (r) => r.source_record_id },
  { label: "Owner", get: (r) => r.owner_name },
  { label: "Owner First Name", get: (r) => r.owner_first_name },
  { label: "Phone", get: (r) => r.phone },
  { label: "Phone Count", get: (r) => r.phone_count },
  { label: "Sqft", get: (r) => r.area_sqft },
  { label: "Contact", get: (r) => (r.contact_type === "probable broker" ? "probable broker" : "owner") },
  { label: "Email", get: (r) => r.email },
  { label: "City", get: (r) => r.city },
  { label: "State", get: (r) => r.state },
  { label: "Address", get: (r) => r.address },
  { label: "AI Calls", get: (r) => r.call_count },
  { label: "Last AI Call", get: (r) => r.last_called_at },
  { label: "AI Call Status", get: (r) => r.last_status },
  { label: "AI Availability", get: (r) => r.last_availability },
  { label: "AI Notes", get: (r) => r.last_notes },
  { label: "AI Transcript", get: (r) => r.last_transcript },
  { label: "AI Recording", get: (r) => r.last_recording_url },
  // Human-calling channel: who owns this record and what they found.
  { label: "Assigned To", get: (r) => r.assigned_to },
  { label: "Human Result", get: (r) => r.assignment_outcome },
  { label: "Human Remarks", get: (r) => r.assignment_remarks },
  { label: "Human In DB", get: (r) => (r.assignment_added_to_db ? "yes" : "") },
  { label: "Human WH ID", get: (r) => r.assignment_wh_id },
  { label: "Metadata (JSON)", get: (r) => (r.metadata ? JSON.stringify(r.metadata) : "") },
];

export const maxDuration = 300;
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const { ids, filters } = await exportInput(req);
    const spec = rawExportQuery(user, ids ? {} : toRawFilters(filters), ids);
    return await csvResponse(spec, COLUMNS, `raw-dataset-${new Date().toISOString().slice(0, 10)}.csv`);
  } catch (error) { return apiError(error); }
}
export const POST = GET;

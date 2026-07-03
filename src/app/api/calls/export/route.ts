import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCallsForExport, type CallFilters, type CallRow } from "@/lib/calls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CSV columns: label + how to pull the value from a row. Mirrors the dashboard grid
// (representative matched listing + match count); pagination-independent.
const COLUMNS: { label: string; get: (r: CallRow) => unknown }[] = [
  { label: "When", get: (r) => r.call_created_at },
  { label: "Direction", get: (r) => (r.call_type === "inbound" ? "Inbound" : "Outbound") },
  { label: "Number", get: (r) => (r.call_type === "inbound" ? r.from_number : r.to_number) },
  { label: "Owner", get: (r) => r.owner_name },
  { label: "Area", get: (r) => r.db_area },
  { label: "Availability", get: (r) => r.availability },
  { label: "Sqft", get: (r) => r.built_up_area_sqft },
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
  { label: "Call Status", get: (r) => r.call_status },
  { label: "Called By", get: (r) => r.called_by },
  { label: "Added to DB", get: (r) => (r.added_to_db ? "yes" : "no") },
  { label: "WH ID", get: (r) => r.wh_id },
];

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const filters: CallFilters = {
    q: sp.get("q") ?? undefined,
    availability: sp.get("availability") ?? undefined,
    agent_id: sp.get("agent_id") ?? undefined,
    status: sp.get("status") ?? undefined,
    source: sp.get("source") ?? undefined,
    state: sp.get("state") ?? undefined,
    contact: sp.get("contact") ?? undefined,
    call_type: sp.get("call_type") ?? undefined,
    date_from: sp.get("date_from") ?? undefined,
    date_to: sp.get("date_to") ?? undefined,
    needs_review: sp.get("needs_review") === "1",
  };

  const rows = await getCallsForExport(filters);

  const lines = [
    COLUMNS.map((c) => csvCell(c.label)).join(","),
    ...rows.map((r) => COLUMNS.map((c) => csvCell(c.get(r))).join(",")),
  ];
  const csv = "﻿" + lines.join("\r\n"); // BOM so Excel reads UTF-8

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="bolna-calls-${stamp}.csv"`,
    },
  });
}

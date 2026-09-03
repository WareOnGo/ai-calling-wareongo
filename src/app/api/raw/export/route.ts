import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getRawRecordsForExport, getRawRecordsByIds, type RawFilters, type RawExportRow } from "@/lib/raw";

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
  { label: "Human Attempts", get: (r) => r.assignment_attempts },
  { label: "Metadata (JSON)", get: (r) => (r.metadata ? JSON.stringify(r.metadata) : "") },
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

  // Explicit selection (checkbox picks) wins; otherwise export the whole filtered set.
  const idsParam = sp.get("ids");
  const ids = idsParam ? idsParam.split(",").filter(Boolean) : null;

  let rows: RawExportRow[];
  if (ids && ids.length > 0) {
    rows = await getRawRecordsByIds(user, ids);
  } else {
    const filters: RawFilters = {
      q: sp.get("q") ?? undefined,
      source: sp.get("source") ?? undefined,
      state: sp.get("state") ?? undefined,
      city: sp.get("city") ?? undefined,
      contact: sp.get("contact") ?? undefined,
      called: sp.get("called") ?? undefined,
      last_result: sp.get("last_result") ?? undefined,
      min_area: sp.get("min_area") ? Number(sp.get("min_area")) : undefined,
      max_area: sp.get("max_area") ? Number(sp.get("max_area")) : undefined,
      has_phone: sp.get("has_phone") === "1",
      assignee: sp.get("assignee") ?? undefined,
    };
    rows = await getRawRecordsForExport(user, filters);
  }

  const lines = [
    COLUMNS.map((c) => csvCell(c.label)).join(","),
    ...rows.map((r) => COLUMNS.map((c) => csvCell(c.get(r))).join(",")),
  ];
  const csv = "﻿" + lines.join("\r\n"); // BOM so Excel reads UTF-8

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="raw-dataset-${stamp}.csv"`,
    },
  });
}

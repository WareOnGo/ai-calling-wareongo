import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getRawRecords, type RawRow } from "@/lib/raw";
import { getCalls, type CallRow } from "@/lib/calls";
import { GridInteractivity } from "../GridInteractivity";
import { ColumnResize } from "../ColumnResize";
import { OutcomeCells } from "../OutcomeCells";
import { IconClipboard, IconPhone } from "../icons";

export const dynamic = "force-dynamic";

// "My Work" — the employee's whole world. Two channels, one page:
//
//   • Records to call — listings assigned for MANUAL verification. There's no
//     bolna_call_logs row for these, so the outcome lands on the assignment.
//     The AI-call columns are still shown: if Bolna already rang that number, the
//     employee should see the transcript before dialling again.
//   • My calls — Bolna calls assigned for follow-up.
//
// Both grids call the same scoped readers the admin pages use. Note the EXPLICIT
// `assignee: user.email` filter: for an employee the scope in lib/scope.ts already
// narrows the query, but for an admin the scope is a no-op — without this filter an
// admin would open "My Work" and get the entire 59k-row dataset.

function fmtDate(s: string | null) {
  if (!s) return "";
  return new Date(s).toLocaleString("en-IN", { dateStyle: "medium" });
}

const RECORD_COLS = [
  "Owner", "Phone", "City", "Sqft", "Address",
  "AI Calls", "AI Result", "AI Notes", "AI Audio",
  "Result", "Remarks", "Tries", "Status",
];

const CALL_COLS = [
  "When", "Number", "Owner", "Area", "AI Availability", "Notes", "Recording",
  "Result", "Remarks", "Tries", "Status",
];

export default async function MyWork() {
  const user = await requireUser();

  // pageSize is generous: a personal queue is tens of rows, not thousands, and
  // paginating two grids on one page is more chrome than it's worth.
  const mine = { assignee: user.email, pageSize: 200 };
  const [records, calls] = await Promise.all([
    getRawRecords(user, mine),
    getCalls(user, mine),
  ]);

  const nothing = records.total === 0 && calls.total === 0;

  return (
    <>
      <div className="page-title">
        <span className="pt-icon"><IconClipboard size={18} /></span> My Work
      </div>

      {/* .stacked, not bare children: two `flex: 1` .gridwrap siblings would each
          grow to fill .dash-main and leave a dead gap between the sections. */}
      <div className="stacked">

      {nothing && (
        <p className="empty-note">
          Nothing is assigned to you yet. An admin assigns records and calls from the
          dashboard — they&apos;ll show up here.
        </p>
      )}

      {records.total > 0 && (
        <>
          <h2 className="section-head">
            Records to call <span className="count">{records.total.toLocaleString()}</span>
          </h2>
          <div className="gridwrap">
            <table className="sheet">
              <thead>
                <tr className="colheads">
                  <th className="rowgutter"></th>
                  {RECORD_COLS.map((c) => <th key={c}>{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {records.rows.map((r: RawRow, i) => (
                  <tr key={r.id} className={r.assignment_state === "done" ? "row-done" : undefined}>
                    <td className="rownum">{i + 1}</td>
                    {/* the admin's instruction for this row, if any */}
                    <td title={r.assignment_note ?? ""}>
                      {r.owner_name}
                      {r.assignment_note && <span className="review-tag">note</span>}
                    </td>
                    <td>{r.phone}</td>
                    <td>{r.city}</td>
                    <td>{r.area_sqft ? Number(r.area_sqft).toLocaleString() : ""}</td>
                    <td className="clip" title={r.address ?? ""}>{r.address}</td>
                    {/* What the AI channel already found on this number */}
                    <td>{r.call_count > 0 ? r.call_count : "—"}</td>
                    <td>{r.last_availability ?? ""}</td>
                    <td className="clip" title={r.last_notes ?? ""}>{r.last_notes ?? ""}</td>
                    <td>
                      {r.last_recording_url
                        ? <a href={r.last_recording_url} target="_blank" rel="noreferrer">Play</a>
                        : ""}
                    </td>
                    {r.assignment_id ? (
                      <OutcomeCells
                        assignmentId={r.assignment_id}
                        outcome={r.assignment_outcome}
                        remarks={r.assignment_remarks}
                        attempts={r.assignment_attempts ?? 0}
                        state={r.assignment_state ?? "open"}
                      />
                    ) : (
                      <td colSpan={4} className="muted">—</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {calls.total > 0 && (
        <>
          <h2 className="section-head">
            <IconPhone size={15} /> My calls <span className="count">{calls.total.toLocaleString()}</span>
          </h2>
          <div className="gridwrap">
            <table className="sheet">
              <thead>
                <tr className="colheads">
                  <th className="rowgutter"></th>
                  {CALL_COLS.map((c) => <th key={c}>{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {calls.rows.map((r: CallRow, i) => (
                  <tr key={r.id} className={r.assignment_state === "done" ? "row-done" : undefined}>
                    <td className="rownum">{i + 1}</td>
                    <td>{fmtDate(r.call_created_at)}</td>
                    <td>{r.call_type === "inbound" ? r.from_number : r.to_number}</td>
                    <td>{r.owner_name ?? r.raw_owner_name}</td>
                    <td>{r.db_area ?? r.raw_city}</td>
                    <td>{r.availability}</td>
                    <td className="clip" title={r.notes ?? ""}>{r.notes}</td>
                    <td>
                      {r.recording_url
                        ? <a href={r.recording_url} target="_blank" rel="noreferrer">Play</a>
                        : ""}
                    </td>
                    {r.assignment_id ? (
                      <OutcomeCells
                        assignmentId={r.assignment_id}
                        outcome={r.assignment_outcome}
                        remarks={r.assignment_remarks}
                        attempts={r.assignment_attempts ?? 0}
                        state={r.assignment_state ?? "open"}
                      />
                    ) : (
                      <td colSpan={4} className="muted">—</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
            Full call detail (transcripts, DB match, workflow columns) is on{" "}
            <Link href="/dashboard/calls">Call Analytics</Link> — it shows the same
            assigned calls.
          </p>
        </>
      )}

      </div>

      <GridInteractivity />
      <ColumnResize />
    </>
  );
}

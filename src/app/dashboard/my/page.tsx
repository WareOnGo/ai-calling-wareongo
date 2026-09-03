import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getRawRecords, type RawRow } from "@/lib/raw";
import { getCalls, type CallRow } from "@/lib/calls";
import { OutcomeCells } from "../OutcomeCells";
import { CopyText } from "../CopyText";
import { IconClipboard, IconPhone, IconPencil } from "../icons";

export const dynamic = "force-dynamic";

// "My Work" — the employee's whole world, and deliberately NOT a spreadsheet.
//
// The admin grids are Sheets-like on purpose (dense, 30px rows, cell selection).
// That is the wrong shape for someone working a call list: they read one row at a
// time, then type into it. So this page uses `.task-sheet`:
//
//   • taller rows with real padding, so a row is a comfortable target
//   • fewer columns, chosen so nothing needs horizontal scrolling at normal widths
//     (address and transcript move into tooltips rather than columns)
//   • a hard visual split — everything left of the divider is system data they
//     cannot change; the tinted "yours" columns are the form
//
// Both grids call the same scoped readers the admin pages use, plus an explicit
// `assignee: user.email` filter — the scope in lib/scope.ts is a no-op for an admin,
// so without it an admin opening this page would get the entire dataset.

// Rent arrives as a bare metadata string. Format it as money when it is purely
// numeric, and otherwise pass it through — sources also store things like
// "13 rs/sqft" that must not be mangled.
function fmtRent(v: string | null): string | null {
  if (!v) return null;
  const digits = v.replace(/[,\s₹]/g, "");
  return /^\d+$/.test(digits) ? `₹${Number(digits).toLocaleString("en-IN")}` : v;
}

function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// What the AI channel already knows about this number, as one compact cell: the
// employee should see it before dialling, but it must not crowd out their own work.
function aiCell(r: { call_count: number; last_availability: string | null; last_notes: string | null; last_called_at: string | null }) {
  if (!r.call_count) return <span className="muted">never called</span>;
  const verdict = (r.last_availability ?? "").trim();
  const tip = [
    `${r.call_count} AI call${r.call_count === 1 ? "" : "s"}`,
    r.last_called_at ? `last ${fmtDate(r.last_called_at)}` : null,
    r.last_notes ? `\n${r.last_notes}` : null,
  ].filter(Boolean).join(" · ");
  return (
    <span title={tip}>
      {verdict
        ? <span className={`pill pill-${verdict.toLowerCase()}`}>{verdict}</span>
        : <span className="pill pill-unclear">no verdict</span>}
      <span className="ai-count">{r.call_count}×</span>
    </span>
  );
}

// Header cells for the columns the employee owns, marked so "what can I edit?" is
// answered by looking rather than by clicking.
function MineHead() {
  return (
    <>
      <th className="mine mine-first"><IconPencil size={12} /> Result</th>
      <th className="mine">Your notes</th>
      <th className="mine">In DB?</th>
      <th className="mine">WH ID</th>
      <th className="mine">Finished?</th>
    </>
  );
}

const RECORD_COLS = ["Who to call", "Phone", "Size", "Type", "Rent", "Where", "AI check"];
const CALL_COLS = ["Called", "Number", "Who", "Size", "Rent", "Where", "AI verdict"];

export default async function MyWork() {
  const user = await requireUser();

  // A personal queue is tens of rows, so it is not paginated — but the cap is
  // explicit rather than accidental.
  const mine = { assignee: user.email, pageSize: 200 };
  const [records, calls] = await Promise.all([
    getRawRecords(user, mine),
    getCalls(user, mine),
  ]);

  const openRecords = records.rows.filter((r) => r.assignment_state !== "done").length;
  const openCalls = calls.rows.filter((r) => r.assignment_state !== "done").length;
  const nothing = records.total === 0 && calls.total === 0;

  return (
    <>
      <div className="page-title">
        <span className="pt-icon"><IconClipboard size={18} /></span> My Work
        {!nothing && (
          <span className="title-sub">
            {openRecords + openCalls === 0
              ? "all caught up"
              : `${openRecords + openCalls} still to do`}
          </span>
        )}
      </div>

      {nothing && (
        <p className="empty-note">
          Nothing is assigned to you yet. An admin hands out work from the dashboard —
          it&apos;ll appear here.
        </p>
      )}

      {!nothing && (
        <p className="legend">
          <span className="legend-sys">Grey columns</span> come from the system and
          can&apos;t be changed.{" "}
          <span className="legend-mine"><IconPencil size={11} /> Tinted columns</span>{" "}
          are yours — they save as you go.
        </p>
      )}

      <div className="stacked">
        {records.total > 0 && (
          <section className="worklist">
            <h2 className="section-head">
              Listings to call
              <span className="count">
                {openRecords === 0 ? `all ${records.total} done` : `${openRecords} left of ${records.total}`}
              </span>
            </h2>
            <div className="gridwrap">
              <table className="sheet task-sheet">
                <thead>
                  <tr className="colheads">
                    <th className="rowgutter"></th>
                    {RECORD_COLS.map((c) => <th key={c}>{c}</th>)}
                    <MineHead />
                  </tr>
                </thead>
                <tbody>
                  {records.rows.map((r: RawRow, i) => (
                    <tr key={r.id} className={r.assignment_state === "done" ? "row-done" : undefined}>
                      <td className="rownum">{i + 1}</td>
                      <td className="who" title={r.address ?? ""}>
                        <span className="who-name">{r.owner_name ?? "(no name)"}</span>
                        {r.assignment_note && (
                          <span className="brief" title={r.assignment_note}>{r.assignment_note}</span>
                        )}
                      </td>
                      <td><CopyText value={r.phone} label="phone number" /></td>
                      <td className="num">{r.area_sqft ? `${Number(r.area_sqft).toLocaleString()} sqft` : "—"}</td>
                      <td>{r.warehouse_type ?? <span className="muted">—</span>}</td>
                      <td className="num">{fmtRent(r.rent) ?? <span className="muted">—</span>}</td>
                      <td>{r.city ?? "—"}</td>
                      <td>{aiCell(r)}</td>
                      {r.assignment_id ? (
                        <OutcomeCells
                          assignmentId={r.assignment_id}
                          outcome={r.assignment_outcome}
                          remarks={r.assignment_remarks}
                          addedToDb={r.assignment_added_to_db ?? false}
                          whId={r.assignment_wh_id}
                          state={r.assignment_state ?? "open"}
                        />
                      ) : (
                        <td colSpan={5} className="muted">—</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {calls.total > 0 && (
          <section className="worklist">
            <h2 className="section-head">
              <IconPhone size={15} /> AI calls to follow up
              <span className="count">
                {openCalls === 0 ? `all ${calls.total} done` : `${openCalls} left of ${calls.total}`}
              </span>
            </h2>
            <div className="gridwrap">
              <table className="sheet task-sheet">
                <thead>
                  <tr className="colheads">
                    <th className="rowgutter"></th>
                    {CALL_COLS.map((c) => <th key={c}>{c}</th>)}
                    <MineHead />
                  </tr>
                </thead>
                <tbody>
                  {calls.rows.map((r: CallRow, i) => (
                    <tr key={r.id} className={r.assignment_state === "done" ? "row-done" : undefined}>
                      <td className="rownum">{i + 1}</td>
                      <td>{fmtDate(r.call_created_at)}</td>
                      <td>
                        <CopyText
                          value={r.call_type === "inbound" ? r.from_number : r.to_number}
                          label="phone number"
                        />
                      </td>
                      <td className="who">
                        <span className="who-name">{r.owner_name ?? r.raw_owner_name ?? "(no name)"}</span>
                        {r.assignment_note && (
                          <span className="brief" title={r.assignment_note}>{r.assignment_note}</span>
                        )}
                      </td>
                      <td className="num">
                        {r.built_up_area_sqft || r.raw_area_sqft
                          ? `${Number(r.built_up_area_sqft || r.raw_area_sqft).toLocaleString()} sqft`
                          : <span className="muted">—</span>}
                      </td>
                      <td className="num">{fmtRent(r.expected_rent) ?? <span className="muted">—</span>}</td>
                      <td>{r.db_area ?? r.raw_city ?? "—"}</td>
                      <td title={r.notes ?? ""}>
                        <span className={`pill pill-${(r.availability ?? "unclear").toLowerCase().split(" ")[0]}`}>
                          {r.availability}
                        </span>
                        {r.recording_url && (
                          <a className="playlink" href={r.recording_url} target="_blank" rel="noreferrer">listen</a>
                        )}
                      </td>
                      {r.assignment_id ? (
                        <OutcomeCells
                          assignmentId={r.assignment_id}
                          outcome={r.assignment_outcome}
                          remarks={r.assignment_remarks}
                          addedToDb={r.assignment_added_to_db ?? false}
                          whId={r.assignment_wh_id}
                          state={r.assignment_state ?? "open"}
                        />
                      ) : (
                        <td colSpan={5} className="muted">—</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="section-foot">
              Full transcripts and the matched listing are on{" "}
              <Link href="/dashboard/calls">Call Analytics</Link>.
            </p>
          </section>
        )}
      </div>
    </>
  );
}

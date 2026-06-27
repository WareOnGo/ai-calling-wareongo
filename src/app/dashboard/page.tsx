import Link from "next/link";
import { getCalls, getFilterOptions, type CallFilters } from "@/lib/calls";

export const dynamic = "force-dynamic";

function pill(availability: string | null) {
  const v = (availability ?? "").toLowerCase();
  if (v === "available") return <span className="pill available">Available</span>;
  if (v === "unavailable") return <span className="pill unavailable">Unavailable</span>;
  if (v.startsWith("dead")) return <span className="pill dead">Dead</span>;
  return <span className="pill unclear">Unclear</span>;
}

function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

type SP = Record<string, string | undefined>;

function qs(base: SP, override: SP) {
  const p = new URLSearchParams();
  const merged = { ...base, ...override };
  for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
  return `?${p.toString()}`;
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const sp: SP = {};
  for (const [k, v] of Object.entries(raw)) sp[k] = Array.isArray(v) ? v[0] : v;
  const filters: CallFilters = {
    q: sp.q,
    availability: sp.availability,
    segment: sp.segment,
    agent_id: sp.agent_id,
    status: sp.status,
    confidence: sp.confidence,
    needs_review: sp.needs_review === "1",
    page: sp.page ? Number(sp.page) : 1,
  };

  const [{ rows, total, page, pages }, opts] = await Promise.all([
    getCalls(filters),
    getFilterOptions(),
  ]);

  const sel = (cur: string | undefined, val: string) => (cur === val ? "selected" : undefined);

  return (
    <>
      {/* Filters — plain GET form, no client JS needed */}
      <form className="filters" method="GET" action="/dashboard">
        <div className="field" style={{ minWidth: 220 }}>
          <label>Search (number / owner / transcript)</label>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="e.g. 98765 or Avinash" />
        </div>
        <div className="field">
          <label>Availability</label>
          <select name="availability" defaultValue={sp.availability ?? ""}>
            <option value="">All</option>
            {opts.availabilities.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Segment</label>
          <select name="segment" defaultValue={sp.segment ?? ""}>
            <option value="">All</option>
            {opts.segments.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Agent</label>
          <select name="agent_id" defaultValue={sp.agent_id ?? ""}>
            <option value="">All</option>
            {opts.agents.map((v) => <option key={v} value={v}>{v.slice(0, 8)}…</option>)}
          </select>
        </div>
        <div className="field">
          <label>Status</label>
          <select name="status" defaultValue={sp.status ?? ""}>
            <option value="">All</option>
            {opts.statuses.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Confidence</label>
          <select name="confidence" defaultValue={sp.confidence ?? ""}>
            <option value="">All</option>
            {opts.confidences.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div className="field check">
          <input type="checkbox" id="nr" name="needs_review" value="1" defaultChecked={sp.needs_review === "1"} />
          <label htmlFor="nr" style={{ textTransform: "none" }}>Needs review</label>
        </div>
        <button className="btn" type="submit">Apply</button>
        <a className="btn secondary" href="/dashboard">Reset</a>
      </form>

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Dir</th>
              <th>Number</th>
              <th>Owner</th>
              <th>Area</th>
              <th>Availability</th>
              <th>Segment</th>
              <th>Area (sqft)</th>
              <th>Rent</th>
              <th>Conf.</th>
              <th>Status</th>
              <th>Rec.</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={12} className="muted" style={{ padding: 24, textAlign: "center" }}>No calls match these filters.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="muted">{fmtDate(r.call_created_at)}</td>
                <td>{r.call_type === "inbound" ? "←" : "→"}</td>
                <td>{r.call_type === "inbound" ? r.from_number : r.to_number}</td>
                <td>{r.owner_name ?? <span className="muted">—</span>}</td>
                <td>{r.db_area ?? <span className="muted">—</span>}</td>
                <td>{pill(r.availability)} {r.needs_review && <span className="pill review">review</span>}</td>
                <td className="muted">{r.segment || "—"}</td>
                <td>{r.built_up_area_sqft || <span className="muted">—</span>}</td>
                <td>{r.expected_rent || <span className="muted">—</span>}</td>
                <td className="muted">{r.confidence ?? "—"}</td>
                <td className="muted">{r.status}</td>
                <td>{r.recording_url ? <a href={r.recording_url} target="_blank" rel="noreferrer">▶</a> : <span className="muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pager">
        <span className="muted">{total.toLocaleString()} calls · page {page} of {pages}</span>
        <div className="pages">
          {page > 1
            ? <Link href={qs(sp, { page: String(page - 1) })}>‹ Prev</Link>
            : <span className="disabled cur">‹ Prev</span>}
          <span className="cur">{page}</span>
          {page < pages
            ? <Link href={qs(sp, { page: String(page + 1) })}>Next ›</Link>
            : <span className="disabled cur">Next ›</span>}
        </div>
      </div>
    </>
  );
}

import { listUsers } from "@/lib/users";
import { searchQuery } from "@/lib/filter-values";
import { EvidenceFilters } from "./EvidenceFilters";
import Link from "next/link";
import { TEAM_METRICS, teamDates, teamSummary, teamDetails, type TeamFilters, type TeamMetric } from "@/lib/team-report";
import type { Viewer } from "@/lib/scope";
import { dateTime } from "@/lib/display";
import { RecordDetails } from "../RecordDetails";
import { RecordsPagination } from "../RecordsPagination";
import { TeamDateRange } from "./TeamDateRange";
import { ResultText } from "../ResultBadge";

export async function TeamReport({ viewer, filters, showEvidence = false }: { viewer: Viewer; filters: TeamFilters; showEvidence?: boolean }) {
  const now = new Date();
  const [people, data, allPeople] = await Promise.all([teamSummary(viewer, filters, now), showEvidence ? teamDetails(viewer, filters, now) : Promise.resolve(null), listUsers()]);
  const base = { date_from: filters.date_from, date_to: filters.date_to, person: filters.person, access: filters.access };
  const href = (caller: string | undefined, metric: TeamMetric) => "/dashboard/team?" + searchQuery({ ...base, metric, ...(caller ? { caller } : {}) }) + "#team-evidence";
  const cell = (email: string, metric: TeamMetric, n = 0) => <Link href={href(email, metric)} aria-label={`${TEAM_METRICS[metric]} for ${email}: ${n}`}>{n.toLocaleString()}</Link>;
  const total = (metric: TeamMetric) => people.reduce((sum, person) => sum + (person.counts[metric] || 0), 0);
  const attempts = total("attempts"), connected = total("connected");
  const summaries: { metric: TeamMetric; label: string; value: string; detail: string }[] = [
    { metric: "attempts", label: "Recorded attempts", value: attempts.toLocaleString(), detail: "Logged manual calls" },
    { metric: "connected", label: "Connect rate", value: attempts ? `${Math.round(connected / attempts * 100)}%` : "—", detail: `${connected.toLocaleString()} of ${attempts.toLocaleString()} recorded attempts` },
    { metric: "available", label: "Available discoveries", value: total("available").toLocaleString(), detail: "First evidence per target, per caller" },
    { metric: "onboarded", label: "Onboarded references", value: total("onboarded").toLocaleString(), detail: "Unique warehouse references" },
  ];
  return <section className="team-report" aria-label="Team performance">
    <TeamDateRange filters={filters} dates={teamDates(now)} people={allPeople}/>
    <div className="team-overview" aria-label="Performance summary">{summaries.map(summary => <Link className="team-metric" href={href(undefined, summary.metric)} key={summary.metric}>
      <span>{summary.label}</span><strong>{summary.value}</strong><small>{summary.detail}</small>
    </Link>)}</div>
    <div className="team-section-heading"><div><h2>Caller performance</h2><p>{people.length} callers · Select a count to inspect its evidence.</p></div><Link href="/dashboard/assignments?quality_review=1">Review completion quality</Link></div>
    <div className="team-report-grid" tabIndex={0} role="region" aria-label="Team metrics table">
      <table className="sheet"><thead><tr><th scope="col">Caller</th><th scope="col">Recorded attempts</th><th scope="col">Connect rate</th><th scope="col">Average call duration</th><th scope="col">First Available targets</th><th scope="col">Onboarded references</th></tr></thead>
        <tbody>{people.map(person => {
          const c = person.counts, attempts = c.attempts || 0, connected = c.connected || 0;
          return <tr key={person.email}>
            <th scope="row"><span className="team-caller-name">{person.name || person.email}</span>{person.name && person.name !== person.email && <span className="team-caller-email">{person.email}</span>}{!person.active && <span className="team-caller-email">Access removed</span>}</th>
            <td className="team-number">{cell(person.email, "attempts", attempts)}</td>
            <td className="team-number"><span className="team-cell-value">{attempts ? `${Math.round(connected / attempts * 100)}%` : "—"}</span><span className="team-cell-meta">{cell(person.email, "connected", connected)} / {cell(person.email, "attempts", attempts)} connected</span></td>
            <td className="team-number"><span className="team-cell-value">{person.average_seconds === null ? "—" : `${person.average_seconds.toFixed(1)}s`}</span><span className="team-cell-meta">{cell(person.email, "duration", person.duration_coverage)} / {cell(person.email, "connected", connected)} timed</span></td>
            <td className="team-number">{cell(person.email, "available", c.available)}</td><td className="team-number">{cell(person.email, "onboarded", c.onboarded)}</td>
          </tr>;
        })}{!people.length && <tr><td colSpan={6}>No callers match these filters. <Link href="/dashboard/team/access">Manage team access</Link></td></tr>}</tbody>
      </table>
    </div>
    <p className="team-coverage-note">Historical call counts are unknown; zero recorded calls does not mean no calls happened. Duration is self-reported, with timed-call coverage shown above.</p>
    <details className="team-definitions"><summary>Metric definitions and historical coverage</summary>
      <p>Dates include full calendar days in India (IST). Call counts and connect rates cover logged manual calls only. Legacy references remain included when dated evidence exists.</p>
      <p>Available discoveries count each listing or execution once per caller, using its first evidence. Reopening and saving again cannot move that credit to a later period. Available found includes work awaiting a warehouse reference; new Available completions require an integer reference. Historical onboarding retains recorded legacy formats and flags them for review. Backdated attempts use their recorded attempt time.</p>
      <p>Attempts use recorded events after corrections. Connected means Connected, Call back later, or Will check and get back. Rates use only these captured events; older notes, autosaves and legacy attempt counters cannot establish call counts. Zero recorded attempts does not prove that no calls happened.</p>
      <p>Average call duration uses self-reported seconds on connected attempts with a known duration; the timed / connected fraction shows coverage. Missing durations are excluded, and a reported zero remains zero. Warehouse references are deduplicated across callers, credited to the first recorded owner, and reflect staff-recorded onboarding. Reused references need review.</p>
      <p>Undated legacy verification is excluded from date-based discoveries and onboarding. Completion quality and follow-ups remain available on Assignments.</p>
    </details>
    {data && <section id="team-evidence" className="team-evidence" aria-label="Metric evidence">
      <div className="team-section-heading"><div><h2>{TEAM_METRICS[filters.metric]}</h2><p>{filters.caller || "All callers"} · {data.total.toLocaleString()} evidence rows</p></div><div className="team-evidence-actions">
        {filters.caller && <Link href={href(undefined, filters.metric)}>All callers</Link>}
        <a className="btn secondary" href={"/api/team/export?" + searchQuery({ ...base, metric: filters.metric, caller: filters.caller, q: filters.q, state: filters.state })}>Export these rows</a>
        <Link href={"/dashboard/team?" + searchQuery(base)}>Close evidence</Link>
      </div></div>
      <EvidenceFilters filters={filters} />
      <div className="team-report-grid team-evidence-grid" tabIndex={0} role="region" aria-label="Metric evidence table"><table className="sheet"><thead><tr><th scope="col">Target</th><th scope="col">Caller</th><th scope="col">Evidence time (IST)</th><th scope="col">Evidence</th><th scope="col">Reported seconds</th><th scope="col">Current task state</th></tr></thead><tbody>
        {data.rows.map((row, index) => <tr key={`${row.event_id}:${index}`}><td><span className="team-evidence-target">{row.subject}<RecordDetails entity={row.entity_type} id={row.entity_id}/></span></td><td>{row.assignee}</td><td>{row.occurred_at ? dateTime(row.occurred_at) : "Current / date unknown"}</td><td><ResultText text={row.detail}/></td><td className="team-number">{row.duration_seconds ?? "Unknown"}</td><td>{row.current_state}</td></tr>)}
        {!data.rows.length && <tr><td colSpan={6}>No evidence rows for this selection.</td></tr>}
      </tbody></table></div>
      <RecordsPagination page={data.page} pages={data.pages} total={data.total} pageSize={50} applied={{ ...base, metric: filters.metric, caller: filters.caller, q: filters.q, state: filters.state }} label="Evidence pages"/>
    </section>}
  </section>;
}

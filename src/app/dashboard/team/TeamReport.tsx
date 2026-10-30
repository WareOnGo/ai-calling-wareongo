import { listUsers } from "@/lib/users";
import { searchQuery } from "@/lib/filter-values";
import Link from "next/link";
import { teamDates, teamSummary, type TeamFilters, type TeamMetric } from "@/lib/team-report";
import type { Viewer } from "@/lib/scope";
import { dateTime } from "@/lib/display";
import { TeamDateRange } from "./TeamDateRange";
import { CallyzerCoverage, CallyzerHistory, callDuration } from "./CallyzerActivity";
import { callyzerReport, callyzerHistory, type ActivityFilters } from "@/lib/callyzer-report";
import { CALLYZER_STREAMS, importCoverage } from "@/lib/callyzer";
import { CallerTable } from "./CallerTable";

export async function TeamReport({ viewer, filters, activity = { activity_channel: "all", activity_page: 1 } }: { viewer: Viewer; filters: TeamFilters; activity?: ActivityFilters }) {
  const now = new Date();
  const [people, allPeople, automatic, history] = await Promise.all([
    teamSummary(viewer, filters, now), listUsers(),
    callyzerReport(viewer, filters, activity), callyzerHistory(viewer, filters, activity),
  ]);
  const base = { range: filters.range, date_from: filters.date_from, date_to: filters.date_to, person: filters.person, access: filters.access, activity_channel: activity.activity_channel };
  const historyHref = (caller: string) => "/dashboard/team?" + searchQuery({ ...base, activity_caller: caller }) + "#caller-history";
  const total = (metric: TeamMetric) => people.reduce((sum, person) => sum + (person.counts[metric] || 0), 0);
  const manualByEmail = new Map(people.map(person => [person.email, person]));
  const callers = automatic.people.map(person => ({
    person, manual: manualByEmail.get(person.email),
    coverage: importCoverage({ number: person.callyzer_number, trackingSince: person.callyzer_tracking_since,
      configured: automatic.configured, state: automatic.state, device: person.callyzer_device,
      from: filters.range === "all" ? null : filters.date_from!, to: filters.range === "all" ? null : filters.date_to!, channel: activity.activity_channel, now }),
  })).sort((a,b) => {
    const recorded = (row: typeof a) => Object.values(row.manual?.counts || {}).some(count => count > 0);
    return Number(b.person.calls > 0 || recorded(b)) - Number(a.person.calls > 0 || recorded(a)) ||
      b.person.calls - a.person.calls || (b.manual?.counts.available || 0) - (a.manual?.counts.available || 0) ||
      (a.person.name || a.person.email).localeCompare(b.person.name || b.person.email);
  });
  const visibleActivity = callers.filter(row => row.coverage.showCounts);
  const received = visibleActivity.reduce((sum, row) => sum + row.person.calls, 0);
  const connected = visibleActivity.reduce((sum, row) => sum + row.person.connected, 0);
  const linked = callers.filter(row => row.person.callyzer_number).length;
  const quiet = (row: typeof callers[number]) => !filters.person && !row.person.callyzer_number && row.person.calls === 0 && !Object.values(row.manual?.counts || {}).some(count => count > 0);
  const quietCount = callers.filter(quiet).length;
  const additionalMembers = quietCount === callers.length ? 0 : quietCount;
  const measured = received > 0 || visibleActivity.some(row => row.coverage.label === "Imported");
  const channel = CALLYZER_STREAMS.find(stream => stream.key === activity.activity_channel)?.label || "All channels";
  const summaries = [
    { label: "Calls received", value: measured ? received.toLocaleString() : "—", source: "Callyzer", detail: `${linked} linked ${linked === 1 ? "caller" : "callers"} · ${channel}` },
    { label: "Connect rate", value: received ? `${Math.round(connected / received * 100)}%` : "—", source: "Callyzer", detail: `${connected.toLocaleString()} connected of ${received.toLocaleString()} received` },
    { label: "Available found", value: total("available").toLocaleString(), source: "Recorded outcomes", detail: "First discovery per target, per caller" },
    { label: "Warehouses onboarded", value: total("onboarded").toLocaleString(), source: "Recorded outcomes", detail: "Unique warehouse references" },
  ];
  return <section className="team-report" aria-label="Team performance">
    <TeamDateRange key={JSON.stringify(base)} filters={filters} dates={teamDates(now)} people={allPeople.filter(person => person.role === "employee")} activity={activity}/>
    <div className="team-overview" aria-label="Performance summary">{summaries.map(summary => <div className="team-metric" key={summary.label}>
      <span className="team-metric-source">{summary.source}</span><span>{summary.label}</span><strong>{summary.value}</strong><small>{summary.detail}</small>
    </div>)}</div>
    <div className="team-data-note">
      <span>{automatic.state?.last_success_at ? `Callyzer imported ${dateTime(automatic.state.last_success_at)}` : "Callyzer import pending"}</span>
      <span>Automatic calls cover linked callers only; device uploads may have gaps.</span>
      <Link href="/dashboard/team/access">Manage caller links</Link>
    </div>
    {automatic.state?.last_error && <p className="team-sync-alert" role="status">The last Callyzer import did not complete. Received call counts may be incomplete.</p>}
    {automatic.unmatched > 0 && <p className="team-sync-alert">{automatic.unmatched.toLocaleString()} calls have no caller attribution. <Link href="/dashboard/team/access">Review caller links</Link></p>}
    <section id="callyzer-activity" className="team-callers" aria-label="Caller performance">
    <div className="team-section-heading"><div><h2>Caller overview</h2><p>Calls and outcomes by caller. Select a call count for history.</p></div><Link href="/dashboard/assignments?quality_review=1">Review completion quality</Link></div>
    <CallerTable key={JSON.stringify(base)} additionalMembers={additionalMembers}>
    <div className="team-report-grid" tabIndex={0} role="region" aria-label="Team metrics table">
      <table className="sheet team-caller-table"><thead><tr><th scope="col">Caller</th><th scope="col">Calls<span>Callyzer</span></th><th scope="col">Connected<span>Callyzer</span></th><th scope="col">Talk time<span>Callyzer</span></th><th scope="col" className="team-outcome-start">Available found<span>Recorded outcome</span></th><th scope="col">Onboarded<span>Recorded outcome</span></th></tr></thead>
        <tbody>{callers.map(row => {
          const {person, manual, coverage} = row;
          const available = coverage.showCounts && (person.calls > 0 || coverage.label === "Imported");
          return <tr key={person.email} data-quiet={quiet(row)}>
            <th scope="row"><span className="team-caller-name">{person.name || person.email}</span>{!person.active && <span className="team-caller-email">Access removed</span>}<CallyzerCoverage person={person} coverage={coverage} now={now}/></th>
            <td className="team-number">{available ? <Link className="team-call-count" href={historyHref(person.email)} aria-label={`Call history for ${person.email}`}>{person.calls.toLocaleString()}</Link> : <span className="team-unavailable" aria-label="Automatic calls unavailable">—</span>}</td>
            <td className="team-number">{available ? <><span className="team-cell-value">{person.connected.toLocaleString()}</span>{person.calls > 0 && <span className="team-cell-meta">{Math.round(person.connected/person.calls*100)}%</span>}</> : <span className="team-unavailable">—</span>}</td>
            <td className="team-number">{available ? callDuration(person.talk_seconds,true) : <span className="team-unavailable">—</span>}{available && person.unknown_durations > 0 && <span className="team-cell-meta">{person.unknown_durations} durations unknown</span>}</td>
            <td className="team-number team-outcome-start">{(manual?.counts.available || 0).toLocaleString()}</td><td className="team-number">{(manual?.counts.onboarded || 0).toLocaleString()}</td>
          </tr>;
        })}{!callers.length && <tr><td colSpan={6}>No callers match these filters. <Link href="/dashboard/team/access">Manage team access</Link></td></tr>}</tbody>
      </table>
    </div>
    </CallerTable>
    <p className="team-table-note">— Automatic activity unavailable. Outcomes remain visible for every caller. Open a status badge to check coverage.</p>
    </section>
    <CallyzerHistory history={history} filters={filters} activity={activity} name={allPeople.find(person => person.email === activity.activity_caller)?.name}/>
    <details className="team-manual-logs">
      <summary><span>Manual call logs</span><span>{total("attempts").toLocaleString()} recorded attempts</span></summary>
      <p>Staff-entered calls are shown separately to avoid counting a call twice. Historical call counts are unknown; zero recorded attempts does not mean no calls happened.</p>
      <div className="team-report-grid" tabIndex={0} role="region" aria-label="Manual call logs table"><table className="sheet"><thead><tr><th scope="col">Caller</th><th scope="col">Recorded attempts</th><th scope="col">Connect rate</th><th scope="col">Average duration</th></tr></thead><tbody>{people.map(person => {
        const attempts = person.counts.attempts || 0, connected = person.counts.connected || 0;
        return <tr key={person.email}><th scope="row">{person.name || person.email}<span className="team-caller-email">{person.name && person.email}</span></th>
          <td className="team-number">{attempts.toLocaleString()}</td>
          <td className="team-number">{attempts ? `${Math.round(connected/attempts*100)}%` : "—"}<span className="team-cell-meta">{connected.toLocaleString()} / {attempts} connected</span></td>
          <td className="team-number">{person.average_seconds === null ? "—" : `${person.average_seconds.toFixed(1)}s`}<span className="team-cell-meta">{person.duration_coverage.toLocaleString()} / {connected} timed</span></td>
        </tr>;
      })}{!people.length && <tr><td colSpan={4}>No callers match these filters.</td></tr>}</tbody></table></div>
    </details>
    <details className="team-definitions"><summary>How these numbers work</summary>
      <p>Callyzer counts received calls from linked callers. Connected means an incoming or outgoing call longer than 2 seconds; talk time sums those calls with a known duration. Manual call logs stay separate to avoid double counting.</p>
      <p>Available found counts the first discovery of a target per caller. Onboarded counts unique warehouse references, credited to the first recorded owner. These are staff-recorded outcomes.</p>
      <p>Dates use full days in IST. Channel filters affect Callyzer calls only. Missing device uploads or an unlinked phone can leave gaps; zero received calls does not establish inactivity.</p>
    </details>
  </section>;
}

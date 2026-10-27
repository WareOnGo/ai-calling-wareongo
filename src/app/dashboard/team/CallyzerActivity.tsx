import Link from "next/link";
import type { TeamFilters } from "@/lib/team-report";
import type { importCoverage } from "@/lib/callyzer";
import type { callyzerHistory, CallerActivity, ActivityFilters } from "@/lib/callyzer-report";
import { dateTime } from "@/lib/display";
import { searchQuery } from "@/lib/filter-values";

export function callDuration(seconds: number, compact = false) {
  return [seconds >= 3600 ? `${Math.floor(seconds/3600)}h` : "", seconds >= 60 ? `${Math.floor(seconds%3600/60)}m` : "", !compact || seconds < 3600 ? `${seconds%60}s` : ""].filter(Boolean).join(" ");
}

export function CallyzerCoverage({ person, coverage, now }: {
  person: CallerActivity; coverage: ReturnType<typeof importCoverage>; now: Date;
}) {
  const device = person.callyzer_device;
  const label = coverage.label === "Future period" ? coverage.label : device?.app_uninstalled ? "App uninstalled" : device?.logging_enabled === false ? "Device logging off" : coverage.label;
  const tone = label === "Imported" ? "current" : label === "Manual only" ? "manual" : "attention";
  return <details className="team-caller-coverage">
    <summary aria-label={`Coverage for ${person.email}`}><span className={`callyzer-status is-${tone}`}>{label}</span></summary>
    <div className="team-device-details">
      <span>{person.email}</span>
      <p>{coverage.detail}</p>
      {person.callyzer_number && <>
        <span>{person.callyzer_number}</span>
        {coverage.through && <span>Imported through {dateTime(coverage.through)}</span>}
        <span>{!device ? "Device status pending" : device.error || device.found === null ? "Employee lookup unavailable — device status unknown" : device.found === false ? "Number not found in Callyzer — check the link" : device.last_sync_req_at ? `Last device sync request: ${dateTime(device.last_sync_req_at)} (upload completeness unknown)` : "Device update time unknown"}</span>
      </>}
      {device && <span>Device checked {dateTime(device.checked_at)}</span>}
      {device?.logging_enabled === false && <span>Device logging off — new device activity may be missing.</span>}
      {device?.app_uninstalled && <span>App uninstalled — new device activity may be missing.</span>}
      {device?.last_sync_req_at && now.getTime()-Date.parse(device.last_sync_req_at)>86400000 && <span>No recent device sync request — check the phone app.</span>}
      {person.last_call_at && <span>Last call in this period: {dateTime(person.last_call_at)}</span>}
      <Link href="/dashboard/team/access">Manage caller link</Link>
    </div>
  </details>;
}

export function CallyzerHistory({ history, filters, activity, name }: {
  history: Awaited<ReturnType<typeof callyzerHistory>>; filters: TeamFilters; activity: ActivityFilters; name?: string | null;
}) {
  if (!history) return null;
  const base = { range: filters.range, date_from: filters.date_from, date_to: filters.date_to, person: filters.person, access: filters.access, activity_channel: activity.activity_channel };
  const href = (page: number) => "/dashboard/team?" + searchQuery({ ...base, activity_caller: activity.activity_caller, activity_page: String(page) }) + "#caller-history";
  return <section id="caller-history" className="team-evidence" aria-label="Caller call history">
    <div className="team-section-heading"><div><h2>Call history · {name || activity.activity_caller}</h2><p>{history.total.toLocaleString()} received calls in this selection · Callyzer</p></div><Link href={"/dashboard/team?" + searchQuery(base) + "#callyzer-activity"}>Close history</Link></div>
    <div className="team-report-grid team-evidence-grid" tabIndex={0} role="region" aria-label="Caller call history table"><table className="sheet"><thead><tr>
      <th scope="col">Contact</th><th scope="col">Call time (IST)</th><th scope="col">Type</th><th scope="col">Channel</th><th scope="col">Duration</th><th scope="col">Uploaded (IST)</th>
    </tr></thead><tbody>{history.rows.map(row => <tr key={row.source_id}>
      <td>{row.client_name || "Unknown contact"}<span className="team-cell-meta">{row.client_number || "Number unavailable"}</span></td>
      <td>{dateTime(row.occurred_at)}</td><td>{row.call_type}</td><td>{row.call_method === "PhoneCall" ? "Phone" : "WhatsApp"} · {row.call_mode.toLowerCase()}</td>
      <td>{row.duration_seconds === null ? "Unknown" : callDuration(row.duration_seconds)}</td><td>{row.provider_synced_at ? dateTime(row.provider_synced_at) : "Unknown"}</td>
    </tr>)}{!history.rows.length && <tr><td colSpan={6}>No imported calls in this selection. Check the caller link, report dates and coverage above.</td></tr>}</tbody></table></div>
    <nav className="callyzer-pagination" aria-label="Call history pages">{history.page > 1 && <Link href={href(history.page-1)}>Previous</Link>}
      <span>Page {history.page} of {history.pages}</span>{history.page < history.pages && <Link href={href(history.page+1)}>Next</Link>}</nav>
  </section>;
}

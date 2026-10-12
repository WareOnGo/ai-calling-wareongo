import Link from "next/link";
import type { teamDates, TeamFilters } from "@/lib/team-report";

export function TeamDateRange({ filters, dates }: { filters: TeamFilters; dates: ReturnType<typeof teamDates> }) {
  return <form action="/dashboard/team" className="team-range">
    <div className="team-date-fields">
      <label>From<input aria-label="Report from" type="date" name="date_from" defaultValue={filters.date_from} required/></label>
      <label>To<input aria-label="Report to" type="date" name="date_to" defaultValue={filters.date_to} required/></label>
      <button className="btn secondary" type="submit">Apply dates</button>
    </div>
    <nav className="team-date-presets" aria-label="Report date presets">{[["Today", dates.today, dates.today], ["Yesterday", dates.yesterday, dates.yesterday], ["Last 7 days", dates.week, dates.today], ["This month", dates.month, dates.today]].map(([label, from, to]) => <Link key={label} aria-current={filters.date_from === from && filters.date_to === to ? "date" : undefined} href={"/dashboard/team?" + new URLSearchParams({ date_from: from, date_to: to })}>{label}</Link>)}</nav>
    <span className="team-date-zone">Dates in IST</span>
  </form>;
}

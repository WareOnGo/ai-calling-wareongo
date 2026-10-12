import Link from 'next/link';
import {TEAM_METRICS,teamDates,teamSummary,teamDetails,type TeamFilters,type TeamMetric} from '@/lib/team-report';
import type {Viewer} from '@/lib/scope';
import {dateTime} from '@/lib/display';
import {manualEvidenceLabel} from '@/lib/manual-dispositions';
import {RecordDetails} from '../RecordDetails';
import {PageJump} from '../PageJump';

export async function TeamReport({viewer,filters,showEvidence=false}:{viewer:Viewer;filters:TeamFilters;showEvidence?:boolean}){
 const now=new Date(),[people,data]=await Promise.all([teamSummary(viewer,filters,now),showEvidence?teamDetails(viewer,filters,now):Promise.resolve(null)]),dates=teamDates(now);
 const href=(caller:string|undefined,metric:TeamMetric)=>'/dashboard/team?'+new URLSearchParams({date_from:filters.date_from,date_to:filters.date_to,metric,...(caller?{caller}:{})});
 const cell=(email:string,metric:TeamMetric,n=0)=><Link href={href(email,metric)} aria-label={`${TEAM_METRICS[metric]} for ${email}: ${n}`}>{n}</Link>;
 return <section className="team-report" aria-label="Team performance">
  <h2>Team performance</h2>
  <form action="/dashboard/team" className="team-range">
   <label>From <input aria-label="Report from" type="date" name="date_from" defaultValue={filters.date_from} required/></label>
   <label>To <input aria-label="Report to" type="date" name="date_to" defaultValue={filters.date_to} required/></label>
   <button className="btn-primary" type="submit">Apply dates</button>
   {[['Today',dates.today,dates.today],['Yesterday',dates.yesterday,dates.yesterday],['Last 7 days',dates.week,dates.today],['This month',dates.month,dates.today]].map(([label,from,to])=><Link key={label} href={'/dashboard/team?'+new URLSearchParams({date_from:from,date_to:to})}>{label}</Link>)}
  </form>
  <p>Dates include full calendar days in India (IST). Call counts and connect rates cover logged manual calls only. Historical call counts are unknown; zero recorded calls does not mean no calls happened. Average duration uses optional self-reported seconds, with coverage shown below.</p>
  <p>Legacy references remain included when dated evidence exists. <Link href="/dashboard/assignments?quality_review=1">Review completion quality</Link></p>
  <div className="team-report-grid" tabIndex={0} aria-label="Team metrics table">
   <table className="sheet"><thead><tr><th>Caller</th><th>Recorded attempts</th><th>Connect rate</th><th>First Available targets</th><th>Onboarded references</th><th>Average call duration</th></tr></thead>
   <tbody>{people.map(p=>{const c=p.counts,attempts=c.attempts||0,connected=c.connected||0;return <tr key={p.email}>
    <td>{p.name||p.email}<small><br/>{p.email}{!p.active?' · Access removed':''}</small></td>
    <td>{cell(p.email,'attempts',c.attempts)}</td>
    <td>{attempts?`${Math.round(connected/attempts*100)}%`:'—'}<br/>{cell(p.email,'connected',connected)} / {cell(p.email,'attempts',attempts)}</td>
    <td>{cell(p.email,'available',c.available)}</td><td>{cell(p.email,'onboarded',c.onboarded)}</td>
    <td>{p.average_seconds===null?'—':`${p.average_seconds.toFixed(1)}s`}<br/>{cell(p.email,'duration',p.duration_coverage)} / {cell(p.email,'connected',connected)} timed</td>

   </tr>})}</tbody></table>
  </div>
  <details className="team-definitions"><summary>Metric definitions and historical coverage</summary>
   <p>Available discoveries count each listing or execution once per caller, using its first evidence. Reopening and saving again cannot move that credit to a later period. Available found includes work awaiting a warehouse reference; new Available completions require an integer reference. Historical onboarding retains recorded legacy formats and flags them for review. Backdated attempts use their recorded attempt time.</p>
   <p>Attempts use recorded events after corrections. Connected means Connected, Call back later, or Will check and get back. Rates use only these captured events; older notes, autosaves and legacy attempt counters cannot establish call counts. Zero recorded attempts does not prove that no calls happened.</p>
   <p>Average call duration uses self-reported seconds on connected attempts with a known duration; the timed / connected fraction shows coverage. Missing durations are excluded, and a reported zero remains zero. Warehouse references are deduplicated across callers, credited to the first recorded owner, and reflect staff-recorded onboarding. Reused references need review.</p>
   <p>Undated legacy verification is excluded from date-based discoveries and onboarding. Completion quality and follow-ups remain available on Assignments.</p>
  </details>
  {data&&<><h3>{TEAM_METRICS[filters.metric]}{filters.caller?` · ${filters.caller}`:' · All callers'}</h3>
  <div className="team-range"><span>{data.total} evidence rows</span><a href={'/api/team/export?'+new URLSearchParams({date_from:filters.date_from,date_to:filters.date_to,metric:filters.metric,...(filters.caller?{caller:filters.caller}:{})})}>Export these rows</a><Link href={href(undefined,filters.metric)}>All callers</Link></div>
  <div className="team-report-grid" tabIndex={0} aria-label="Metric evidence table"><table className="sheet"><thead><tr><th>Caller</th><th>Target</th><th>Evidence time (IST)</th><th>Evidence</th><th>Reported seconds</th><th>Current task state</th></tr></thead><tbody>
   {data.rows.map((r,i)=><tr key={`${r.event_id}:${i}`}><td>{r.assignee}</td><td>{r.subject} <RecordDetails entity={r.entity_type} id={r.entity_id}/></td><td>{r.occurred_at?dateTime(r.occurred_at):'Current / date unknown'}</td><td>{manualEvidenceLabel(r.detail)}</td><td>{r.duration_seconds??'Unknown'}</td><td>{r.current_state}</td></tr>)}
   {!data.rows.length&&<tr><td colSpan={6}>No evidence rows for this selection.</td></tr>}
  </tbody></table></div>
  <div className="pager"><span>Page {data.page} of {data.pages}</span><PageJump key={`${filters.metric}:${filters.caller}:${data.page}`} page={data.page} pages={data.pages}/></div>
 </>}
 </section>;
}

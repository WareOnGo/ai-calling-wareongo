import { TeamHeader } from "./TeamHeader";
import { TeamAccessNote } from "./TeamStructure";
import { FiltersToggle } from "../FiltersToggle";

const Skeleton = ({ width = "75%", height = 12 }: { width?: string | number; height?: number }) => <span className="skeleton" style={{ width, height }}/>;

export function TeamLoading({ view = "performance" }: { view?: "performance" | "access" }) {
  return <><span className="sr-only" role="status">Loading {view === "performance" ? "team performance" : "access control"}…</span>
    <div className="loading-page" data-loading-view={view === "performance" ? "team" : "team-access"} aria-hidden="true" inert>
      <TeamHeader view={view} loading/>
      <div className={`team-page${view === "access" ? " team-access-page" : ""}`}>
        {view === "performance" ? <section className="team-report">
          <div className="team-report-filters"><div className="filterbar records-toolbar"><div className="toolbar-search"><span className="filter-context"><Skeleton width={200}/></span><FiltersToggle count={0} disabled/><button className="btn apply-button" disabled>Apply</button></div></div></div>
          <div className="team-overview">{[["Recorded attempts", "Logged manual calls"], ["Connect rate", "0 of 0 recorded attempts"], ["Available discoveries", "First evidence per target, per caller"], ["Onboarded references", "Unique warehouse references"]].map(([label, detail]) => <div className="team-metric" key={label}><span>{label}</span><strong><Skeleton width={50} height={24}/></strong><small>{detail}</small></div>)}</div>
          <div className="team-section-heading"><div><h2>Caller performance</h2><p><Skeleton width={250}/></p></div><a>Review completion quality</a></div>
          <div className="team-report-grid"><table className="sheet"><thead><tr>{["Caller", "Recorded attempts", "Connect rate", "Average call duration", "First Available targets", "Onboarded references"].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{Array.from({ length: 7 }, (_, row) => <tr key={row}>{Array.from({ length: 6 }, (_, column) => <td key={column}><Skeleton/><span className="team-cell-meta"><Skeleton width="50%"/></span></td>)}</tr>)}</tbody></table></div>
        </section> : <div className="team">
          <div className="team-access-toolbar"><TeamAccessNote/><button className="btn-primary add-trigger" disabled>Add someone</button></div>
          <div className="filterbar records-toolbar team-directory-tools"><div className="toolbar-search"><div className="search"><input disabled placeholder="Search by name or email…"/></div><FiltersToggle count={0} disabled/><button className="btn apply-button" disabled>Apply</button></div><div className="toolbar-actions"><Skeleton width={150}/></div></div>
          {["Admins", "Employees", "No access"].map(title => <section className="people-group" key={title}><h2 className="group-head">{title}<span className="count"><Skeleton width={10}/></span></h2><ul className="people">{Array.from({ length: 2 }, (_, index) => <li className="person" key={index}><span className="avatar skeleton"/><span className="person-id"><span className="person-name"><Skeleton width={130}/></span><span className="person-email"><Skeleton width={150}/></span></span><span className="person-load"><Skeleton width={80}/></span><span className="person-role"><Skeleton width="100%" height={34}/></span><span className="switch"><Skeleton width="100%"/></span></li>)}</ul></section>)}
        </div>}
      </div>
    </div>
  </>;
}

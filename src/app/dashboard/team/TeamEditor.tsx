"use client";

import { TeamAccessNote } from "./TeamStructure";
import { useState } from "react";
import Link from "next/link";
import { useDashboardUI } from "../DashboardUI";
import { requestJson } from "../requests";
import { IconPlus, IconCheck, IconUsers, IconLock } from "../icons";

export type Person = {
  email: string;
  name: string | null;
  role: string;
  active: boolean;
  open: number;
  done: number;
};

// A people directory, not a grid. Every control states its consequence, because
// this list is what grants and revokes sign-in.
export function TeamEditor({
  people, activeAdmins, myEmail,
}: { people: Person[]; activeAdmins: number; myEmail: string }) {
  const { pending, refresh, notify } = useDashboardUI();
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ key: string; error?: string; body: Record<string, unknown>; text?: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("employee");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [accessFilter, setAccessFilter] = useState("");
  const filtered = !!(search.trim() || roleFilter || accessFilter);

  async function save(body: Record<string, unknown>, key: string) {
    if (busy || pending) return false;
    setBusy(key);
    setFeedback(null);
    try {
      await requestJson("/api/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const text = key === "new" ? `Access granted to ${body.email}` : body.active === false ? `Access removed for ${key}` : body.active === true ? `Access restored for ${key}` : `Role updated for ${key}`;
      setFeedback({ key, body, text });
      notify(text);
      refresh();
      return true;
    } catch (err) {
      setFeedback({ key, body, error: err instanceof Error ? err.message : "Couldn't save. Try again." });
      return false;
    } finally { setBusy(null); }
  }
  function status(key: string) {
    return <span className="team-feedback" role="status">{busy === key ? "Saving…" : feedback?.key === key ? feedback.error ? <span className="assign-error">{feedback.error} <button type="button" className="btn-text" disabled={!!busy || pending} onClick={() => save(feedback.body, key)}>Retry</button></span> : feedback.text : null}</span>;
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    if (await save({ email: email.trim(), name: name.trim() || null, role }, "new")) {
      setEmail(""); setName(""); setRole("employee"); setOpen(false);
    }
  }

  const matching = people.filter(person => `${person.name || ""} ${person.email}`.toLowerCase().includes(search.trim().toLowerCase()) && (!roleFilter || person.role === roleFilter) && (!accessFilter || person.active === (accessFilter === "active")));
  const groups: { key: string; title: string; hint: string; rows: Person[] }[] = [
    {
      key: "admins", title: "Admins", hint: "Full access — can assign work and manage this list.",
      rows: matching.filter((p) => p.active && p.role === "admin"),
    },
    {
      key: "employees", title: "Employees", hint: "See only the work assigned to them.",
      rows: matching.filter((p) => p.active && p.role === "employee"),
    },
    {
      key: "revoked", title: "No access", hint: "Cannot sign in. Their past work is kept.",
      rows: matching.filter((p) => !p.active),
    },
  ];

  return (
    <div className="team">
      <div className="team-access-toolbar"><TeamAccessNote />
        {!open && <button type="button" className="btn-primary add-trigger" disabled={!!busy || pending} onClick={() => setOpen(true)}><IconPlus size={15}/> Add someone</button>}
      </div>

      {open ? (
        <form className="addcard" onSubmit={add} aria-busy={busy === "new"}>
          <fieldset disabled={!!busy || pending} className="plain-fieldset">
          <div className="addcard-head">Add someone</div>
          <div className="addcard-fields">
            <label className="fld">
              <span>Google account</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="name@wareongo.com" required autoFocus />
            </label>
            <label className="fld">
              <span>Display name <em>optional</em></span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Priya" />
            </label>
            <label className="fld fld-narrow">
              <span>Role</span>
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="employee">Employee</option>
                <option value="admin">Admin</option>
              </select>
            </label>
          </div>
          <div className="addcard-foot">
            <span className="muted">
              {role === "admin"
                ? "Admins can see the full dataset and place calls."
                : "Employees only see what you assign them."}
            </span>
            <span className="spacer" />
            <button type="button" className="btn-text" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy === "new"}>
              {busy === "new" ? "Adding…" : "Add & grant access"}
            </button>
          </div>
          {status("new")}
          </fieldset>
        </form>
      ) : null}

      {!open && feedback?.key === "new" && status("new")}

      <div className="team-directory-tools">
        <label className="team-member-search"><span className="sr-only">Search team members</span><input type="search" placeholder="Search by name or email…" value={search} onChange={event => setSearch(event.target.value)}/></label>
        <label className="directory-filter"><span>Role</span><select aria-label="Filter by role" value={roleFilter} onChange={event => setRoleFilter(event.target.value)}><option value="">All roles</option><option value="admin">Admins</option><option value="employee">Employees</option></select></label>
        <label className="directory-filter"><span>Access</span><select aria-label="Filter by access" value={accessFilter} onChange={event => setAccessFilter(event.target.value)}><option value="">All members</option><option value="active">Can sign in</option><option value="removed">Access removed</option></select></label>
        <span role="status">{filtered ? `${matching.length} of ${people.length} members` : `${people.filter(person => person.active).length} with access · ${people.length} members`}</span>
        {filtered && <button type="button" className="btn-text" onClick={() => { setSearch(""); setRoleFilter(""); setAccessFilter(""); }}>Clear filters</button>}
      </div>
      {!matching.length && filtered && <p className="team-no-matches">No members match these filters. Try another name, role or access status.</p>}
      {groups.filter(group => !filtered || group.rows.length).map((g) => (
        <section key={g.key} className="people-group">
          <h2 className="group-head">
            {g.title} <span className="count">{g.rows.length}</span>
            <span className="group-hint">{g.hint}</span>
          </h2>

          {g.rows.length === 0 ? (
            <p className="group-empty">
              {g.key === "revoked" ? "Nobody has been removed." : `No ${g.title.toLowerCase()} yet.`}
            </p>
          ) : (
            <ul className="people">
              {g.rows.map((p) => {
                const isMe = p.email.toLowerCase() === myEmail.toLowerCase();
                const lastAdmin = p.active && p.role === "admin" && activeAdmins <= 1;
                // Why a control is locked, or null when it isn't.
                const locked = isMe
                  ? "This is you — you can't remove your own access"
                  : lastAdmin
                    ? "The last admin can't be removed — promote someone else first"
                    : null;
                return (
                  <li key={p.email} aria-busy={busy === p.email} className={`person${p.active ? "" : " is-off"}`}>
                    <span className="avatar" aria-hidden="true">{initials(p)}</span>
                    <span className="person-id">
                      <span className="person-name">
                        {p.name || p.email.split("@")[0]}
                        {isMe && <span className="you">you</span>}
                      </span>
                      <span className="person-email">{p.email}</span>
                    </span>

                    <span className="person-load">
                      {p.open > 0 && <Link className="pill pill-open" href={`/dashboard/assignments?assignee=${encodeURIComponent(p.email)}&state=open`}>{p.open} open</Link>}
                      {p.done > 0 && <Link className="pill pill-done" href={`/dashboard/assignments?assignee=${encodeURIComponent(p.email)}&state=done`}>{p.done} done</Link>}
                      {p.open === 0 && p.done === 0 && <span className="muted">no work yet</span>}
                    </span>

                    <span className="person-role">
                      <select
                        className="field field-select"
                        aria-label={`Role for ${p.email}`}
                        value={p.role}
                        disabled={!!busy || pending || !!locked}
                        title={locked ?? undefined}
                        onChange={(e) => save({ email: p.email, role: e.target.value }, p.email)}
                      >
                        <option value="employee">Employee</option>
                        <option value="admin">Admin</option>
                      </select>
                    </span>

                    <button
                      type="button"
                      className={`switch${p.active ? " on" : ""}${locked && p.active ? " locked" : ""}`}
                      role="switch"
                      aria-checked={p.active}
                      aria-label={`Access for ${p.email}`}
                      disabled={!!busy || pending || (!!locked && p.active)}
                      title={p.active ? (locked ?? "Switch off to revoke access") : "Switch on to restore access"}
                      onClick={() => save({ email: p.email, active: !p.active }, p.email)}
                    >
                      <span className="switch-track"><span className="switch-knob" /></span>
                      <span className="switch-label">
                        {p.active
                          ? <>{locked ? <IconLock size={12} /> : <IconCheck size={12} />} Can sign in</>
                          : "No access"}
                      </span>
                    </button>
                    {status(p.email)}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}

      {people.length === 0 && (
        <p className="empty-note">
          <IconUsers size={14} /> Nobody has been added yet. Add your account first to manage team access here.
        </p>
      )}
    </div>
  );
}

function initials(p: Person): string {
  const src = (p.name || p.email.split("@")[0]).trim();
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

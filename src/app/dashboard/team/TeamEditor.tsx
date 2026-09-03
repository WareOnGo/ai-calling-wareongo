"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("employee");

  async function save(body: Record<string, unknown>, key: string) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    if (await save({ email: email.trim(), name: name.trim() || null, role }, "new")) {
      setEmail(""); setName(""); setRole("employee"); setOpen(false);
    }
  }

  const groups: { key: string; title: string; hint: string; rows: Person[] }[] = [
    {
      key: "admins", title: "Admins", hint: "Full access — can assign work and manage this list.",
      rows: people.filter((p) => p.active && p.role === "admin"),
    },
    {
      key: "employees", title: "Employees", hint: "See only the work assigned to them.",
      rows: people.filter((p) => p.active && p.role === "employee"),
    },
    {
      key: "revoked", title: "No access", hint: "Cannot sign in. Their past work is kept.",
      rows: people.filter((p) => !p.active),
    },
  ];

  return (
    <div className="team">
      <p className="callout">
        <strong>This list controls who can sign in.</strong> Add someone and they can
        log in with that Google account; switch access off and they&apos;re out on their
        next click — no redeploy either way.
      </p>

      {open ? (
        <form className="addcard" onSubmit={add}>
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
        </form>
      ) : (
        <button type="button" className="btn-primary add-trigger" onClick={() => setOpen(true)}>
          <IconPlus size={15} /> Add someone
        </button>
      )}

      {error && <p className="assign-error">{error}</p>}

      {groups.map((g) => (
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
                  <li key={p.email} className={`person${p.active ? "" : " is-off"}`}>
                    <span className="avatar" aria-hidden="true">{initials(p)}</span>
                    <span className="person-id">
                      <span className="person-name">
                        {p.name || p.email.split("@")[0]}
                        {isMe && <span className="you">you</span>}
                      </span>
                      <span className="person-email">{p.email}</span>
                    </span>

                    <span className="person-load">
                      {p.open > 0 && <span className="pill pill-open">{p.open} open</span>}
                      {p.done > 0 && <span className="pill pill-done">{p.done} done</span>}
                      {p.open === 0 && p.done === 0 && <span className="muted">no work yet</span>}
                    </span>

                    <span className="person-role">
                      <select
                        className="field field-select"
                        aria-label={`Role for ${p.email}`}
                        value={p.role}
                        disabled={busy === p.email || !!locked}
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
                      disabled={busy === p.email || (!!locked && p.active)}
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
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}

      {people.length === 0 && (
        <p className="empty-note">
          <IconUsers size={14} /> Nobody has been added yet. You&apos;re signed in through
          the <code>ADMIN_EMAILS</code> bootstrap — add yourself here to make it permanent.
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

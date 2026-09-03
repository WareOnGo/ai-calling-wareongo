"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconPlus } from "../icons";

type Row = {
  email: string;
  name: string | null;
  role: string;
  active: boolean;
  open: number;
  done: number;
};

// Client island for the admin team table. Every mutation is the same upsert
// (POST /api/users) — "make this row look like this" — then a router.refresh() so
// the server component re-renders with fresh workload counts.
export function TeamEditor({ users }: { users: Row[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      setError(err instanceof Error ? err.message : "Save failed");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    const ok = await save({ email: email.trim(), name: name.trim() || null, role }, "new");
    if (ok) { setEmail(""); setName(""); setRole("employee"); }
  }

  return (
    <>
      <form className="team-add" onSubmit={add}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@company.com"
          required
        />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" />
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="employee">Employee</option>
          <option value="admin">Admin</option>
        </select>
        <button type="submit" className="btn-primary" disabled={busy === "new"}>
          <IconPlus size={15} /> {busy === "new" ? "Adding…" : "Add"}
        </button>
      </form>

      {error && <p className="assign-error">{error}</p>}

      <div className="gridwrap">
        <table className="sheet">
          <thead>
            <tr className="colheads">
              <th className="rowgutter"></th>
              <th>Email</th><th>Name</th><th>Role</th><th>Open</th><th>Done</th><th>Active</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr>
                <td className="rownum"></td>
                <td colSpan={6} className="muted" style={{ textAlign: "center", padding: 24 }}>
                  No users yet — add one above.
                </td>
              </tr>
            )}
            {users.map((u, i) => (
              <tr key={u.email} className={u.active ? undefined : "row-done"}>
                <td className="rownum">{i + 1}</td>
                <td>{u.email}</td>
                <td>{u.name ?? <span className="muted">—</span>}</td>
                <td className="edit">
                  <select
                    className="cell-input"
                    value={u.role}
                    disabled={busy === u.email}
                    onChange={(e) => save({ email: u.email, role: e.target.value }, u.email)}
                  >
                    <option value="employee">Employee</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td>{u.open || ""}</td>
                <td className="muted">{u.done || ""}</td>
                <td className="edit">
                  <label className="done-check">
                    <input
                      type="checkbox"
                      checked={u.active}
                      disabled={busy === u.email}
                      onChange={(e) => save({ email: u.email, active: e.target.checked }, u.email)}
                    />
                    {u.active ? "Active" : "Off"}
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

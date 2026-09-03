import { requireAdmin } from "@/lib/auth";
import { listUsers, getWorkload } from "@/lib/users";
import { TeamEditor } from "./TeamEditor";
import { IconUsers } from "../icons";

export const dynamic = "force-dynamic";

// Admin-only: manage app_users and see who's carrying what.
export default async function Team() {
  await requireAdmin();
  const [users, workload] = await Promise.all([listUsers(), getWorkload()]);

  // Fold the per-(assignee, entity, state) counts into one row per person.
  type Row = { open: number; done: number };
  const byUser = new Map<string, Row>();
  for (const w of workload) {
    const row = byUser.get(w.assignee) ?? { open: 0, done: 0 };
    if (w.state === "open") row.open += w.n;
    if (w.state === "done") row.done += w.n;
    byUser.set(w.assignee, row);
  }

  return (
    <>
      <div className="page-title"><span className="pt-icon"><IconUsers size={18} /></span> Team</div>
      <p className="empty-note" style={{ marginBottom: 16 }}>
        Roles live in <code>bolna_app_users</code>. Access is still gated by the{" "}
        <code>ALLOWED_EMAILS</code> env allowlist — adding someone here does not let
        them sign in unless their email is allowlisted too. Anyone signed in without
        a row here is treated as an employee (admin if in <code>ADMIN_EMAILS</code>).
      </p>

      <TeamEditor
        users={users.map((u) => ({
          ...u,
          open: byUser.get(u.email)?.open ?? 0,
          done: byUser.get(u.email)?.done ?? 0,
        }))}
      />
    </>
  );
}

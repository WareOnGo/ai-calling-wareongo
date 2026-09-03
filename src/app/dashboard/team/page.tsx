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
        This list <strong>is</strong> the access list. Adding someone here lets them
        sign in with that Google account; unticking <em>Active</em> revokes it
        immediately — no env var, no redeploy. Someone with no row here cannot sign in
        at all. <code>ADMIN_EMAILS</code> only applies as a bootstrap while no active
        admin row exists, so it stops having any effect once this table has one.
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

import { requireAdmin } from "@/lib/auth";
import { listUsers, getWorkload } from "@/lib/users";
import { TeamEditor, type Person } from "./TeamEditor";
import { IconUsers } from "../icons";

export const dynamic = "force-dynamic";

// Admin-only. Since bolna_app_users became the access list (there is no
// ALLOWED_EMAILS any more), this page IS access control — so it's laid out as a
// people directory grouped by what each person can do, not as another spreadsheet.
export default async function Team() {
  const me = await requireAdmin();
  const [users, workload] = await Promise.all([listUsers(), getWorkload()]);

  const counts = new Map<string, { open: number; done: number }>();
  for (const w of workload) {
    const row = counts.get(w.assignee) ?? { open: 0, done: 0 };
    if (w.state === "open") row.open += w.n;
    if (w.state === "done") row.done += w.n;
    counts.set(w.assignee, row);
  }

  const people: Person[] = users.map((u) => ({
    ...u,
    open: counts.get(u.email)?.open ?? 0,
    done: counts.get(u.email)?.done ?? 0,
  }));

  // Passed down so the UI can DISABLE the last admin's controls with an explanation,
  // rather than letting the click through to a 400 from the API.
  const activeAdmins = people.filter((p) => p.active && p.role === "admin").length;

  return (
    <>
      <div className="page-title">
        <span className="pt-icon"><IconUsers size={18} /></span> Team
        <span className="title-sub">{people.filter((p) => p.active).length} with access</span>
      </div>
      <TeamEditor people={people} activeAdmins={activeAdmins} myEmail={me.email} />
    </>
  );
}

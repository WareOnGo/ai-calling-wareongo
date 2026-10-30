import { requireAdmin } from "@/lib/auth";
import { getWorkload, listUsers } from "@/lib/users";
import { TeamEditor, type Person } from "../TeamEditor";
import { TeamHeader } from "../TeamHeader";

export const dynamic = "force-dynamic";

export default async function TeamAccess() {
  const me = await requireAdmin();
  const [users, workload] = await Promise.all([listUsers(), getWorkload()]);
  const counts = new Map<string, { open: number; done: number }>();
  for (const row of workload) {
    const count = counts.get(row.assignee) ?? { open: 0, done: 0 };
    if (row.state === "open") count.open += row.n;
    if (row.state === "done") count.done += row.n;
    counts.set(row.assignee, count);
  }
  const people: Person[] = users.map(user => ({ ...user, open: counts.get(user.email)?.open ?? 0, done: counts.get(user.email)?.done ?? 0 }));
  const activeAdmins = people.filter(person => person.active && person.role === "admin").length;
  return <><TeamHeader view="access"/><div className="team-page team-access-page"><TeamEditor people={people} activeAdmins={activeAdmins} myEmail={me.email}/></div></>;
}

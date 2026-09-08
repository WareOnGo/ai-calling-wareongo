import { personalTotals } from "@/lib/personal-work";
import { assignmentTotals } from "@/lib/assignments";
import { requireUser } from "@/lib/auth";
import { HubCards } from "./HubCards";

export const dynamic = "force-dynamic";

// Role-aware hub. Employees get a two-card page (their work + the calls they own);
// admins additionally get the dataset and team management.
export default async function DashboardHome() {
  const user = await requireUser();
  const [mine, team] = await Promise.all([personalTotals(user.email), user.isAdmin ? assignmentTotals() : Promise.resolve(null)]);
  const open = mine.record.open + mine.call.open;

  return <HubCards isAdmin={user.isAdmin} open={open} teamOpen={team?.open ?? 0} />;
}

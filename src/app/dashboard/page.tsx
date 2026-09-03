import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { IconPhone, IconDataset, IconUsers, IconClipboard } from "./icons";

export const dynamic = "force-dynamic";

// Role-aware hub. Employees get a two-card page (their work + the calls they own);
// admins additionally get the dataset and team management.
export default async function DashboardHome() {
  const user = await requireUser();

  return (
    <div className="hub">
      <div className="hub-grid">
        <Link className="hub-card" href="/dashboard/my">
          <div className="hub-icon"><IconClipboard size={28} /></div>
          <h2>My Work</h2>
          <p>Records assigned to you to call and verify, plus the AI calls you own. Log the outcome as you go.</p>
          <span className="hub-go">Open →</span>
        </Link>

        <Link className="hub-card" href="/dashboard/calls">
          <div className="hub-icon"><IconPhone size={28} /></div>
          <h2>Call Analytics</h2>
          <p>
            {user.isAdmin
              ? "Browse, filter, and review Bolna verification calls — availability, transcripts, and the matched dataset listing for every number."
              : "The Bolna calls assigned to you — availability, transcripts, recordings, and the matched dataset listing."}
          </p>
          <span className="hub-go">Open →</span>
        </Link>

        {user.isAdmin && (
          <Link className="hub-card" href="/dashboard/raw">
            <div className="hub-icon"><IconDataset size={28} /></div>
            <h2>Raw Dataset</h2>
            <p>View and filter the master warehouse dataset across all sources. Queue records for a Bolna batch, or assign them for manual calling.</p>
            <span className="hub-go">Open →</span>
          </Link>
        )}

        {user.isAdmin && (
          <Link className="hub-card" href="/dashboard/team">
            <div className="hub-icon"><IconUsers size={28} /></div>
            <h2>Team</h2>
            <p>Manage accounts and roles, and see how much work each person has open.</p>
            <span className="hub-go">Open →</span>
          </Link>
        )}
      </div>
    </div>
  );
}

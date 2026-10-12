import Link from "next/link";
import { IconPhone, IconDataset, IconUsers, IconClipboard } from "./icons";

export function HubCards({ isAdmin, open = 0, teamOpen = 0, loading = false }: {
  isAdmin: boolean; open?: number; teamOpen?: number; loading?: boolean;
}) {
  return (
    <div className="hub">
      <div className="hub-grid">
        <Link className="hub-card" href="/dashboard/my">
          <div className="hub-icon"><IconClipboard size={28} /></div>
          <h2>My Work</h2>
          <p>Records assigned to you to call and verify, plus the AI calls you own. Log the outcome as you go.</p>
          <span className="hub-go">{loading ? <span className="skeleton" style={{width:150,height:15}} /> : open ? `${open} assignments to do →` : "View my work →"}</span>
        </Link>

        {isAdmin && <Link className="hub-card" href="/dashboard/calls">
          <div className="hub-icon"><IconPhone size={28} /></div>
          <h2>Call Analytics</h2>
          <p>
            Browse, filter, and review Bolna verification calls — availability, transcripts, and the matched dataset listing for every number.
          </p>
          <span className="hub-go">Open →</span>
        </Link>}

        {isAdmin && (
          <Link className="hub-card" href="/dashboard/raw">
            <div className="hub-icon"><IconDataset size={28} /></div>
            <h2>Raw Dataset</h2>
            <p>View and filter the master warehouse dataset across all sources. Queue records for a Bolna batch, or assign them for manual calling.</p>
            <span className="hub-go">Open →</span>
          </Link>
        )}

        {isAdmin && (
          <Link className="hub-card" href="/dashboard/assignments">
            <div className="hub-icon"><IconClipboard size={28} /></div>
            <h2>Assignments</h2>
            <span className="pill pill-open">{loading ? <span className="skeleton skeleton-inline" style={{width:24}} /> : teamOpen} open across the team</span>
            <p>Everything you&apos;ve handed out, in one log — who has it, how many tries, what they found, and what&apos;s still open.</p>
            <span className="hub-go">Open →</span>
          </Link>
        )}

        {isAdmin && (
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

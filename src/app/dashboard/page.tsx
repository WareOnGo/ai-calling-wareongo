import Link from "next/link";
import { IconPhone, IconDataset } from "./icons";

export const dynamic = "force-dynamic";

export default function DashboardHome() {
  return (
    <div className="hub">
      <div className="hub-grid">
        <Link className="hub-card" href="/dashboard/calls">
          <div className="hub-icon"><IconPhone size={28} /></div>
          <h2>Call Analytics</h2>
          <p>Browse, filter, and review Bolna verification calls — availability, transcripts, and the matched dataset listing for every number.</p>
          <span className="hub-go">Open →</span>
        </Link>

        <Link className="hub-card" href="/dashboard/raw">
          <div className="hub-icon"><IconDataset size={28} /></div>
          <h2>Raw Dataset</h2>
          <p>View and filter the master warehouse dataset across all sources. Select records to queue for a Bolna calling batch.</p>
          <span className="hub-go">Open →</span>
        </Link>
      </div>
    </div>
  );
}

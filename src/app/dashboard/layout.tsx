import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { SignOutButton } from "./SignOutButton";
import { ThemeToggle } from "./ThemeToggle";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="app">
      <div className="header">
        <div className="brand">
          <Link href="/dashboard" className="brand-link">
            <span className="logo">B</span>
            <h1>Bolna Calls</h1>
          </Link>
          {/* Nav is role-aware; the pages guard themselves too (requireAdmin), so a
              hidden link is convenience, not the access control. */}
          <nav className="topnav">
            <Link href="/dashboard/my">My Work</Link>
            <Link href="/dashboard/calls">Call Analytics</Link>
            {user.isAdmin && <Link href="/dashboard/raw">Raw Dataset</Link>}
            {user.isAdmin && <Link href="/dashboard/assignments">Assignments</Link>}
            {user.isAdmin && <Link href="/dashboard/team">Team</Link>}
          </nav>
        </div>
        <div className="user">
          <ThemeToggle />
          <span>{user.email}</span>
          <SignOutButton />
        </div>
      </div>
      <div className="dash-main">{children}</div>
    </div>
  );
}

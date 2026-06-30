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
          <nav className="topnav">
            <Link href="/dashboard/calls">Call Analytics</Link>
            <Link href="/dashboard/raw">Raw Dataset</Link>
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

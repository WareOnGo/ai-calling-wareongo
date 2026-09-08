import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { SignOutButton } from "./SignOutButton";
import { ThemeToggle } from "./ThemeToggle";
import { DashboardUI } from "./DashboardUI";
import { Navigation } from "./Navigation";
import { ViewModeToggle } from "./ViewModeToggle";
import { LoadingColumnStyles } from "./LoadingColumnStyles";
import { CALL_COLUMNS, CALL_GROUPS, RAW_COLUMNS, RAW_GROUPS } from "./sheet-columns";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="app">
      <LoadingColumnStyles view="calls" labels={["Row", ...(user.isAdmin ? ["Select"] : []), ...CALL_COLUMNS, ...(user.isAdmin ? ["Assigned To"] : [])]} groups={CALL_GROUPS} />
      <LoadingColumnStyles view="raw" labels={["Row", "Select", ...RAW_COLUMNS]} groups={RAW_GROUPS} />
      <DashboardUI isAdmin={user.isAdmin} userEmail={user.email} header={
      <div className="header">
        <div className="brand">
          <Link href="/dashboard" className="brand-link">
            <span className="logo">B</span>
            <h1>Bolna Calls</h1>
          </Link>
          {/* Nav is role-aware; the pages guard themselves too (requireAdmin), so a
              hidden link is convenience, not the access control. */}
          <Navigation admin={user.isAdmin} />
        </div>
        <div className="user">
          {user.canSwitchView && <ViewModeToggle admin={user.isAdmin} />}
          <ThemeToggle />
          <span className="account-email" title={user.email}>{user.email}</span>
          <SignOutButton />
        </div>
      </div>
      }>{children}</DashboardUI>
    </div>
  );
}

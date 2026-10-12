import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { AccountMenu } from "./AccountMenu";
import { ThemeToggle } from "./ThemeToggle";
import { DashboardUI } from "./DashboardUI";
import { Navigation } from "./Navigation";
import { LoadingColumnStyles } from "./LoadingColumnStyles";
import { callColumns, RAW_COLUMNS } from "./sheet-columns";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="app">
      <LoadingColumnStyles view="calls" labels={["Row", ...(user.isAdmin ? ["Select"] : []), ...callColumns(user.isAdmin)]} />
      <LoadingColumnStyles view="raw" labels={["Row", "Select", ...RAW_COLUMNS]} />
      <DashboardUI isAdmin={user.isAdmin} userEmail={user.email} header={
      <div className="header app-header">
        <div className="brand">
          <Link href="/dashboard" className="brand-link">
            <span className="logo" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 9v6m5-10v14m5-12v10m5-7v4"/></svg></span>
            <h1>Bolna Calls</h1>
          </Link>
          {/* Nav is role-aware; the pages guard themselves too (requireAdmin), so a
              hidden link is convenience, not the access control. */}
          <Navigation admin={user.isAdmin} />
        </div>
        <div className="user">
          <ThemeToggle />
          <AccountMenu name={user.name} email={user.email} admin={user.isAdmin} canSwitch={!!user.canSwitchView}/>
        </div>
      </div>
      }>{children}</DashboardUI>
    </div>
  );
}

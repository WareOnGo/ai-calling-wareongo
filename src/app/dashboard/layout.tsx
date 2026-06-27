import { requireUser } from "@/lib/auth";
import { SignOutButton } from "./SignOutButton";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="app">
      <div className="header">
        <div className="brand">
          <span className="logo">B</span>
          <h1>Bolna Calls</h1>
        </div>
        <div className="user">
          <span>{user.email}</span>
          <SignOutButton />
        </div>
      </div>
      <div className="dash-main">{children}</div>
    </div>
  );
}

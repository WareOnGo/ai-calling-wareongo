"use client";

export function SignOutButton() {
  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  }
  return (
    <button className="btn secondary" onClick={signOut} style={{ padding: "6px 12px" }}>
      Sign out
    </button>
  );
}

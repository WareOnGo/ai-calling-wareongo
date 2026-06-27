import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  not_allowed: "That Google account isn't on the access list.",
  email_not_verified: "Your Google email isn't verified.",
  oauth_not_configured: "Sign-in isn't configured on the server.",
  invalid_state: "Sign-in expired — please try again.",
  token_exchange_failed: "Google sign-in failed — please try again.",
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  const raw = await searchParams;
  const error = Array.isArray(raw.error) ? raw.error[0] : raw.error;
  const email = Array.isArray(raw.email) ? raw.email[0] : raw.email;
  const msg = error ? (ERRORS[error] ?? "Sign-in failed.") : null;

  return (
    <div className="login">
      <div className="card">
        <h1 style={{ marginTop: 0 }}>Bolna Calls</h1>
        <p className="muted" style={{ marginTop: 4, marginBottom: 24 }}>
          WareOnGo voice-AI call dashboard
        </p>
        <a className="btn" href="/api/auth/google">Sign in with Google</a>
      </div>
      {msg && (
        <div className="error-banner">
          {msg}{email ? ` (${email})` : ""}
        </div>
      )}
    </div>
  );
}

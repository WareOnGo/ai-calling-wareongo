"use client";
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="page-error" role="alert"><h1>Couldn't open the dashboard</h1><p>Please try again. If your access changed, sign in again or contact an admin.</p><button type="button" className="btn" onClick={reset}>Retry</button><a href="/">Sign in</a></main>;
}

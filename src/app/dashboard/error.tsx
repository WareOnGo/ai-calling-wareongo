"use client";
export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="page-error" role="alert"><h2>Couldn't load this view</h2><p>Please check your connection and try again.</p><button type="button" className="btn" onClick={reset}>Retry</button><a href="/dashboard">Return to dashboard</a></div>;
}

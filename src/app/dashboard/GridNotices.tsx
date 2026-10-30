import Link from "next/link";

// Keep report context beside its title, shared with loading screens.
export function AiReviewNotice({ count }: { count: number | string }) {
  return <div className="report-context"><Link className="report-review" href="/dashboard/calls?needs_review=1">Needs AI review: {count}</Link><CallGridHint/></div>;
}

export function CallGridHint() {
  return <details className="report-guide"><summary>About this report</summary><p>AI and manual results are independent. Needs AI review means low-confidence inference; inspect the transcript or recording. Called By is legacy metadata. Manual attempt history records the caller and time.</p></details>;
}

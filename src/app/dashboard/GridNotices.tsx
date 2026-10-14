import Link from "next/link";

// Keep report context beside its title, shared with loading screens.
export function AiReviewNotice({ count }: { count: number | string }) {
  return <div className="report-context"><Link className="report-review" href="/dashboard/calls?needs_review=1">Needs AI review: {count}</Link><CallGridHint/></div>;
}

export function AssignmentNotices() {
  return <nav className="assignment-review-links" aria-label="Assignment reviews"><Link href="/dashboard/assignments?quality_review=1">Review questionable completions</Link><Link href="/dashboard/assignments?follow_up=due">Follow-ups due</Link></nav>;
}

export function CallGridHint() {
  return <details className="report-guide"><summary>About this report</summary><p>AI and manual results are independent. Needs AI review means low-confidence inference; inspect the transcript or recording. Called By is legacy metadata. Manual attempt history records the caller and time.</p></details>;
}

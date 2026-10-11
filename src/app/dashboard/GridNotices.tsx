import Link from "next/link";

// Share the notices with loading screens so the grid does not move on arrival.
export function AiReviewNotice({ count }: { count: number | string }) {
  return <p><Link href="/dashboard/calls?needs_review=1">Needs AI review: {count}</Link> — low-confidence inference; inspect the transcript or recording.</p>;
}

export function AssignmentNotices() {
  return <p><Link href="/dashboard/assignments?quality_review=1">Review questionable completions</Link> · <Link href="/dashboard/assignments?follow_up=due">Follow-ups due</Link></p>;
}

export function CallGridHint() {
  return <p className="grid-hint">AI result and Manual result are independent. Needs AI review means low-confidence inference. Called By is legacy metadata; manual attempt history records the caller and time.</p>;
}

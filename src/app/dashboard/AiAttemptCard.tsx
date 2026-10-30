import type { AiAttemptSummary } from "@/lib/ai-summary";
import { RecordDetails } from "./RecordDetails";

export function AiAttemptCard({ entity, id, summary }: {
  entity: "record" | "call"; id: string; summary: AiAttemptSummary;
}) {
  if (!summary.total) return <span className="muted">0 outbound · 0 inbound</span>;
  const unknown = summary.total - summary.outbound - summary.inbound;
  return <RecordDetails entity={entity} id={id} initialSection="AI activity" label="Show AI attempts"
    ariaLabel="Show AI attempts" className={`btn-row ai-attempt-summary ai-attempt-${summary.result?.toLowerCase() || "unknown"}`}
    title={entity === "record"
      ? "Open AI activity for this contact. Result priority: Available → Unavailable → Unclear across calls."
      : "Open the AI call timeline for this number. Counts shown here belong to this execution."}>
    <span className="ai-attempt-result">{summary.result || "View attempts"}<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg></span>
    <span className="ai-attempt-counts">{summary.outbound} outbound · {summary.inbound} inbound{unknown > 0 && <> · {unknown} unknown direction</>}</span>
  </RecordDetails>;
}

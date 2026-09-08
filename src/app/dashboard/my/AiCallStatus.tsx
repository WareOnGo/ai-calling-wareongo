import { resultClass } from "@/lib/display";

export function AiCallStatus({ result, count = 0, loading = false }: { result?: string | null; count?: number; loading?: boolean }) {
  if (loading) return <div className="work-ai"><span className="skeleton" style={{ width: 108, height: 22 }} /><span className="skeleton" style={{ width: 55, height: 12 }} /></div>;
  const label = result ? `AI: ${result}` : count > 0 ? "No AI result" : "No AI calls yet";
  const hint = result ? "Availability from the latest AI call. Record your own result in the Result column." : count > 0 ? "The latest AI call has no recorded availability result." : undefined;
  return <div className="work-ai">
    <span className={`pill work-ai-status ${result ? `pill-${resultClass(result)}` : "work-ai-empty"}`} title={hint}>{label}</span>
    {count > 0 && <span className="work-ai-count">{count.toLocaleString("en-IN")} {count === 1 ? "AI call" : "AI calls"}</span>}
  </div>;
}

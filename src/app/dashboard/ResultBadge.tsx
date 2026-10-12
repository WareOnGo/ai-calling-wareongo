import { resultClass } from "@/lib/display";

export function ResultBadge({ value, empty = "No result", prefix = "", className = "", title }: {
  value?: string | null; empty?: string; prefix?: string; className?: string; title?: string;
}) {
  if (!value?.trim()) return <span className={`muted ${className}`} title={title}>{empty}</span>;
  return <span className={`pill pill-${resultClass(value)} ${className}`} title={title}>{prefix}{value}</span>;
}

// Team evidence includes the recorded result alongside its source and caller.
export function ResultText({ text }: { text: string }) {
  return <>{text.split(/\b(Available|Unavailable|Unclear)\b/g).map((part, index) =>
    /^(Available|Unavailable|Unclear)$/.test(part) ? <ResultBadge key={index} value={part}/> : part
  )}</>;
}

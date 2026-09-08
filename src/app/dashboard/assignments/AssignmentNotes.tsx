"use client";
import { useState } from "react";

export function AssignmentNotes({ text }: { text: string | null }) {
  const [expanded, setExpanded] = useState(false);
  if (!text?.trim()) return <span className="muted">No notes yet</span>;
  const long = text.length > 130 || text.split("\n").length > 2;
  return <div className="assignment-notes">
    <div className={long && !expanded ? "notes-preview" : undefined}>{text}</div>
    {long && <button type="button" className="btn-text" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Show less" : "Show more"}</button>}
  </div>;
}

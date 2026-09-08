"use client";
import { useState } from "react";
import { IconClipboard } from "../icons";
import { dateTime } from "@/lib/display";

export function AssignmentBrief({ id, note, assignedBy, name, assignedAt }: { id: string; note: string | null; assignedBy: string; name: string | null; assignedAt: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = !!note && (note.length > 130 || note.split("\n").length > 2);
  return <>
    {note?.trim() ? <div className="work-assignment-note">
      <span className="work-note-label"><IconClipboard size={12} />Assigner&apos;s note</span>
      <div id={`brief-${id}`} className={`brief${long && !expanded ? " brief-preview" : ""}`}>{note}</div>
      {long && <button type="button" className="btn-text" aria-expanded={expanded} aria-controls={`brief-${id}`} onClick={() => setExpanded(!expanded)}>{expanded ? "Show less" : "Read full note"}</button>}
    </div> : null}
    <div className="work-assigned-meta"><span title={assignedBy}>Assigned by {name || assignedBy}</span><time dateTime={assignedAt} title={dateTime(assignedAt)}>{new Date(assignedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}</time></div>
  </>;
}

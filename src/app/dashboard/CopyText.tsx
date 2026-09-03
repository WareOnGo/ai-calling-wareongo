"use client";

import { useState } from "react";
import { IconCopy, IconCheck } from "./icons";

// Text plus an always-visible copy button — used for phone numbers, which people
// need to get into a dialler or WhatsApp without risking a mis-typed digit.
//
// The icon is shown rather than revealed on hover: this is the main thing anyone
// does with a phone cell, so hiding it behind hover would be hiding the feature.
// Grid cells are also `cursor: cell` and clickable for selection, so the button
// stops propagation to avoid fighting GridInteractivity for the click.
export function CopyText({
  value, label, display,
}: {
  value: string | null;
  label?: string;
  /**
   * What to SHOW, when it differs from what gets copied — the admin grids pass the
   * <mark>-highlighted search match here. Swapping these cells to CopyText silently
   * dropped that highlighting until this existed; the clipboard still gets the raw
   * `value`, never the marked-up node.
   */
  display?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!value) return <span className="muted">—</span>;

  async function copy(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value!);
      } else {
        // Older/insecure contexts have no clipboard API — fall back rather than
        // silently doing nothing.
        const ta = document.createElement("textarea");
        ta.value = value!;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setFailed(true);
      window.setTimeout(() => setFailed(false), 1600);
    }
  }

  return (
    <span className="copytext">
      <span className="copytext-v">{display ?? value}</span>
      <button
        type="button"
        className={`copybtn${copied ? " ok" : ""}${failed ? " err" : ""}`}
        onClick={copy}
        aria-label={`Copy ${label ?? "value"}`}
        title={failed ? "Couldn't copy — select the text instead" : copied ? "Copied" : `Copy ${label ?? ""}`.trim()}
      >
        {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
      </button>
    </span>
  );
}

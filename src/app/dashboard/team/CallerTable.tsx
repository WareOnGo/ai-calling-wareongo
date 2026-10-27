"use client";

import { useId, useState, type ReactNode } from "react";

export function CallerTable({ children, additionalMembers }: { children: ReactNode; additionalMembers: number }) {
  const [showAll, setShowAll] = useState(false);
  const id = useId();
  return <div className="team-caller-list" data-show-all={showAll || additionalMembers === 0}>
    <div id={id}>{children}</div>
    {additionalMembers > 0 && <button type="button" className="team-show-members" aria-expanded={showAll} aria-controls={id} onClick={() => setShowAll(!showAll)}>
      {showAll ? "Show fewer callers" : `Show ${additionalMembers} more ${additionalMembers === 1 ? "caller" : "callers"} without recorded activity`}
    </button>}
  </div>;
}

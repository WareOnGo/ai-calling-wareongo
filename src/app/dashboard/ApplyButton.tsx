"use client";

import { useEffect, useRef, useState } from "react";
import { filterFormSnapshot } from "./filter-form-state";
import { useDashboardUI } from "./DashboardUI";

// Apply is enabled only when the draft differs from the applied query.
export function ApplyButton({ label = "Apply", primary = false }: { label?: string; primary?: boolean } = {}) {
  const { pending, transitioning } = useDashboardUI();
  const ref = useRef<HTMLButtonElement>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const btn = ref.current;
    const form = btn?.closest("form");
    if (!form) return;

    const serialize = () => filterFormSnapshot(form);
    const initial = serialize();
    const onChange = () => setDirty(serialize() !== initial);

    form.addEventListener("input", onChange);
    form.addEventListener("change", onChange);
    return () => {
      form.removeEventListener("input", onChange);
      form.removeEventListener("change", onChange);
    };
  }, []);

  return (
    <button ref={ref} type="submit" className={`${primary ? "btn-primary" : "btn"} apply-button`} disabled={!dirty || pending}>
      {transitioning ? "Applying…" : label}
    </button>
  );
}

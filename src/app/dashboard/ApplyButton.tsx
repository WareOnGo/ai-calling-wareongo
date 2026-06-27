"use client";

import { useEffect, useRef, useState } from "react";

// Blue + enabled only when the filter form differs from the currently-applied
// state; grey + disabled when there's nothing new to apply.
export function ApplyButton() {
  const ref = useRef<HTMLButtonElement>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const btn = ref.current;
    const form = btn?.closest("form");
    if (!form) return;

    const serialize = () => {
      const parts: string[] = [];
      for (const [k, v] of new FormData(form).entries()) parts.push(`${k}=${String(v)}`);
      return parts.join("&");
    };
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
    <button ref={ref} type="submit" className="btn" disabled={!dirty}>
      Apply
    </button>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// "Infer" button shown on calls that landed unenriched (e.g. an OpenAI outage
// during processing). Re-runs OpenAI inference for the single call, then refreshes
// the grid so the freshly-filled availability / sqft / notes show up in place.
export function EnrichButton({ id }: { id: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [err, setErr] = useState<string>("");

  async function run() {
    setState("loading");
    setErr("");
    try {
      const res = await fetch(`/api/calls/${id}/enrich`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErr(body?.error || `HTTP ${res.status}`);
        setState("error");
        return;
      }
      // Server data changed — re-render the row with the new inference fields.
      router.refresh();
      setState("idle");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "request failed");
      setState("error");
    }
  }

  return (
    <button
      type="button"
      className={`btn-infer${state === "error" ? " err" : ""}`}
      onClick={run}
      disabled={state === "loading"}
      title={state === "error" ? `Inference failed: ${err} — click to retry` : "Run OpenAI inference on this call"}
    >
      {state === "loading" ? "Inferring…" : state === "error" ? "Retry infer" : "Infer"}
    </button>
  );
}

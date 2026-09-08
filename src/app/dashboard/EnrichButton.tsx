"use client";

import { useState } from "react";
import { useDashboardUI } from "./DashboardUI";
import { requestJson } from "./requests";

// "Analyse call" button shown on calls that landed unenriched (e.g. an OpenAI outage
// during processing). Re-runs OpenAI inference for the single call, then refreshes
// the grid so the freshly-filled availability / sqft / notes show up in place.
export function EnrichButton({ id }: { id: string }) {
  const { refresh, notify } = useDashboardUI();
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [err, setErr] = useState<string>("");

  async function run() {
    setState("loading");
    setErr("");
    try {
      await requestJson(`/api/calls/${id}/enrich`, { method: "POST", signal: AbortSignal.timeout(120000) });
      notify("AI analysis updated");
      refresh();
      setState("idle");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Analysis failed. Try again.";
      setErr(message);
      notify(message);
      setState("error");
    }
  }

  return (
    <span><button
      type="button"
      className={`btn-infer${state === "error" ? " err" : ""}`}
      onClick={run}
      disabled={state === "loading"}
      title={state === "error" ? `Analysis failed: ${err} — click to retry` : "Analyse the call transcript with AI"}
    >
      {state === "loading" ? "Analysing…" : state === "error" ? "Retry analysis" : "Analyse call"}
    </button>{state === "error" && <span role="status" className="save-status error">{err}</span>}</span>
  );
}

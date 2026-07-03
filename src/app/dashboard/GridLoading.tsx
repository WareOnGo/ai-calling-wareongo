import { IconDataset, IconPhone } from "./icons";

// Suspense fallback shown while a grid page (re)fetches — on first load, filter
// applies, search, and pagination (any searchParams navigation into the segment).
// Keeps the page chrome so a slow query reads as "loading", not "broken".
export function GridLoading({ view }: { view: "calls" | "raw" }) {
  return (
    <>
      <div className="page-title">
        <span className="pt-icon">{view === "calls" ? <IconPhone size={18} /> : <IconDataset size={18} />}</span>
        {view === "calls" ? "Call Analytics" : "Raw Dataset"}
      </div>
      <div className="grid-loading">
        <span className="spinner" aria-hidden="true" />
        <span className="muted">Loading…</span>
      </div>
    </>
  );
}

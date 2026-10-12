import { type QueueSel, type CallCat, dedupByNumber, normNum } from "./queue";
import { routeLanguage, type RoutingMode, type CallLanguage } from "./routing";

export const KNOWN_CATS: CallCat[] = ["dead", "unclear", "available", "unavailable"];

export type DispatchSummary = {
  total: number;            // rows after dedup (the full candidate set)
  excludedCats: CallCat[];  // categories the caller asked to drop
  excludedByCat: number;    // rows removed by those category exclusions
  heldRegion: number;       // rows held by routing or missing agent configuration
  alreadyQueued: number;    // rows skipped because the number is in a live batch
  skippedNoNumber: number;  // kept rows without a valid normalized phone
  callable: QueueSel[];     // final list (deduped, in-category, routable, not-queued, has phone)
  groups: Record<CallLanguage, QueueSel[]>;
};

// Build the final callable batch from candidate rows. Idempotent and pure so it can
// be unit-tested and reused by the route. `excludeCats` mirrors the modal's toggles;
// routing uses the available agents and active reservations apply across languages.
// Filter order: dedup → category → routing → already-queued → valid number.
export function assembleBatch(rows: QueueSel[], excludeCats: CallCat[] = [],
  options: { mode?: RoutingMode; availableLanguages?: readonly CallLanguage[] } = {}): DispatchSummary {
  const mode = options.mode ?? "auto";
  const available = new Set(options.availableLanguages ?? ["hindi"]);
  const deduped = dedupByNumber(rows);
  const excl = new Set(excludeCats.filter((c): c is CallCat => KNOWN_CATS.includes(c)));
  const afterCat = deduped.filter((r) => !(r.cat && excl.has(r.cat)));
  const routable = afterCat.filter((r) => { const language = routeLanguage(r.state, mode); return language !== null && available.has(language); });
  const notQueued = routable.filter((r) => !r.queued);
  const callable = notQueued.filter((r) => /^\d{10}$/.test(normNum(r.contact)));
  const groups: Record<CallLanguage, QueueSel[]> = { hindi: [], english: [] };
  for (const row of callable) groups[routeLanguage(row.state, mode)!].push(row);
  return {
    total: deduped.length,
    excludedCats: [...excl],
    excludedByCat: deduped.length - afterCat.length,
    heldRegion: afterCat.length - routable.length,
    alreadyQueued: routable.length - notQueued.length,
    skippedNoNumber: notQueued.length - callable.length,
    callable,
    groups,
  };
}

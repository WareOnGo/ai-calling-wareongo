// Region/language dispatch routing + call scheduling. Pure + unit-tested.
//
// Geography is the default routing policy, not a claim about an owner's language.
// Explicit English selection can override it; Hindi keeps the existing region guard.
export const CALL_LANGUAGES = ["hindi", "english"] as const;
export type CallLanguage = typeof CALL_LANGUAGES[number];
export type RoutingMode = "auto" | CallLanguage;
export const LANGUAGE_LABELS: Record<CallLanguage, string> = { hindi: "Hindi", english: "English" };

const HINDI_BLOCKED = new Set(["tamil nadu", "kerala", "karnataka"]);

export function isHindiBlocked(state: string | null | undefined): boolean {
  return HINDI_BLOCKED.has((state ?? "").trim().toLowerCase());
}

export function routeLanguage(state: string | null | undefined, mode: RoutingMode = "auto"): CallLanguage | null {
  if (mode === "english") return "english";
  if (isHindiBlocked(state)) return mode === "auto" ? "english" : null;
  return "hindi";
}

// Bolna's /batches/{id}/schedule needs scheduled_at ≥2 min in the future, as an ISO
// timestamp with a NUMERIC offset (a trailing "Z" is rejected), and it rounds up to
// the next 10-minute mark anyway. Keep another two minutes for the dispatch request
// budget (database work plus provider upload), so the slot stays valid on arrival.
export function computeScheduleAt(now: Date): string {
  const TEN_MIN = 600_000;
  const ms = now.getTime();
  let slot = Math.ceil(ms / TEN_MIN) * TEN_MIN;
  if (slot - ms < 240_000) slot += TEN_MIN;
  return toOffsetIso(new Date(slot));
}

// Format as YYYY-MM-DDTHH:mm:ss.000+00:00 (UTC) — Bolna rejects the "Z" suffix.
export function toOffsetIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.000+00:00`
  );
}

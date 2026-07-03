// Region/language dispatch routing + call scheduling. Pure + unit-tested.
//
// The current Bolna agent is Hindi-only, so Tamil Nadu / Kerala / Karnataka must be
// blocked from it (no English agent yet). These states are HELD BACK from a batch
// until an English agent is configured. State strings match raw_records.state exactly
// (verified against the DB) but are compared case-insensitively.

const HINDI_BLOCKED = new Set(["tamil nadu", "kerala", "karnataka"]);

export function isHindiBlocked(state: string | null | undefined): boolean {
  return HINDI_BLOCKED.has((state ?? "").trim().toLowerCase());
}

// Bolna's /batches/{id}/schedule needs scheduled_at ≥2 min in the future, as an ISO
// timestamp with a NUMERIC offset (a trailing "Z" is rejected), and it rounds up to
// the next 10-minute mark anyway. This computes the earliest valid "ASAP" slot in UTC.
export function computeScheduleAt(now: Date): string {
  const TEN_MIN = 600_000;
  const ms = now.getTime();
  let slot = Math.ceil(ms / TEN_MIN) * TEN_MIN;
  if (slot - ms < 120_000) slot += TEN_MIN; // keep ≥2 min of headroom
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

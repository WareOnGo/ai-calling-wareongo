/** Callyzer account and dashboard dates use India time. API range bounds use Unix seconds. */
export const CALLYZER_STREAMS = [
  { key: "phone", method: "PhoneCall", mode: "Voice", label: "Phone" },
  { key: "whatsapp_voice", method: "WhatsAppCall", mode: "Voice", label: "WhatsApp voice" },
  { key: "whatsapp_video", method: "WhatsAppCall", mode: "Video", label: "WhatsApp video" },
] as const;
export type CallyzerChannel = "all" | typeof CALLYZER_STREAMS[number]["key"];
export type StreamProgress = {
  since: number; through: number; backfilled: boolean;
  request_order?: number;
  window?: { from: number; to: number; page: number; page_size?: number; hash?: string };
};
export type SyncState = {
  streams: Partial<Record<typeof CALLYZER_STREAMS[number]["key"], StreamProgress>>;
  last_attempt_at: string | null; last_success_at: string | null; last_error: string | null;
};
export type CallyzerDevice = {
  checked_at: string; found: boolean | null; last_sync_req_at: string | null;
  error?: string; logging_enabled?: boolean | null; app_uninstalled?: boolean | null;
};
export function callyzerAccount() { return process.env.CALLYZER_ACCOUNT_KEY?.trim() || "primary"; }

export function normalizeEmployeeNumber(value: string): string {
  const match = /^\+?([1-9]\d{0,3})-([\d\s]+)$/.exec(value.trim());
  if (!match || !/^\d{6,14}$/.test(match[2].replace(/\s/g, ""))) throw new Error("Use country code and number, for example 91-9876543210");
  return `${match[1]}-${match[2].replace(/\s/g, "")}`;
}

/** Full contact identity; local numbers use this dashboard's India convention. */
export function normalizeContactNumber(value: string | null): string | null {
  if (!value) return null;
  const compact = value.trim().replace(/[\s().-]/g, "");
  if (!/^\+?\d+$/.test(compact)) return null;
  const international = compact.startsWith("+") || compact.startsWith("00");
  let digits = compact.replace(/^\+|^00/, "");
  if (!international && /^0\d{10}$/.test(digits)) digits = digits.slice(1);
  if (!international && digits.length === 10) digits = "91" + digits;
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

/** Reject ambiguous/invalid timestamps rather than checkpointing past an unimported row. */
export function callyzerTime(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error("Invalid Callyzer timestamp");
  let normalized = value.trim();
  // Employee metadata uses account-local display dates in the live API.
  const display = /^(\d{1,2}) ([a-z]{3}) (\d{4}), (\d{1,2}):(\d{2}) (AM|PM)$/i.exec(normalized);
  if (display) {
    const month = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(display[2].toLowerCase()) + 1;
    const hour = Number(display[4]);
    if (!month || hour < 1 || hour > 12) throw new Error("Invalid Callyzer timestamp");
    const hour24 = hour % 12 + (display[6].toUpperCase() === "PM" ? 12 : 0);
    normalized = `${display[3]}-${String(month).padStart(2,"0")}-${display[1].padStart(2,"0")} ${String(hour24).padStart(2,"0")}:${display[5]}:00`;
  }
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d{1,3})?\s*(IST|UTC|Z|[+-]\d{2}:?\d{2})?$/.exec(normalized);
  if (!match) throw new Error("Invalid Callyzer timestamp");
  const wall = `${match[1]}T${match[2]}${match[3] || ""}`;
  const probe = new Date(wall + "Z");
  if (!Number.isFinite(probe.getTime()) || probe.toISOString().slice(0,19) !== wall.slice(0,19)) throw new Error("Invalid Callyzer timestamp");
  const zone = !match[4] || match[4] === "IST" ? "+05:30" : match[4] === "UTC" ? "Z" : match[4];
  const result = new Date(wall + zone);
  if (!Number.isFinite(result.getTime())) throw new Error("Invalid Callyzer timestamp");
  return result.toISOString();
}

/** Live employee settings may use Yes/No instead of documented booleans. */
export function callyzerFlag(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return text === "yes" ? true : text === "no" ? false : null;
}

export function trackingStart(date: string): string {
  return callyzerTime(`${date} 00:00:00`)!;
}
export function indiaDate(instant: string | Date): string {
  return new Date(new Date(instant).getTime() + 330 * 60000).toISOString().slice(0,10);
}
export type ImportedCall = {
  source_id: string; employee_number: string; client_name: string | null; client_number: string | null;
  occurred_at: string; duration_seconds: number | null; call_type: string; call_method: string; call_mode: string;
  provider_synced_at: string | null; provider_modified_at: string | null;
};
export function parseCallyzerCall(input: unknown, stream: typeof CALLYZER_STREAMS[number]): ImportedCall {
  if (!input || typeof input !== "object") throw new Error("Invalid Callyzer call");
  const row = input as Record<string, unknown>;
  const str = (key: string) => row[key] === null || row[key] === undefined ? "" : String(row[key]).trim();
  const rawDuration = typeof row.duration === "string" ? row.duration.trim() : row.duration;
  const duration = rawDuration === null || rawDuration === undefined || rawDuration === "" ? null : Number(rawDuration);
  const type = str("call_type");
  if (typeof row.id !== "string" || !str("id") || !["Incoming","Outgoing","Missed","Rejected"].includes(type) ||
    (row.duration !== null && row.duration !== undefined && typeof row.duration !== "string" && typeof row.duration !== "number") ||
    (typeof rawDuration === "string" && rawDuration !== "" && !/^\d+$/.test(rawDuration)) ||
    (duration !== null && (!Number.isSafeInteger(duration) || duration < 0 || duration > 2147483647)) ||
    (row.call_method && row.call_method !== stream.method) || (row.call_mode && row.call_mode !== stream.mode)) throw new Error("Invalid Callyzer call");
  const time = str("call_time");
  const occurred = callyzerTime(`${str("call_date")} ${/^\d{2}:\d{2}$/.test(time) ? `${time}:00` : time}`);
  if (!occurred) throw new Error("Missing Callyzer call time");
  return {
    source_id: str("id"), employee_number: normalizeEmployeeNumber(`${str("emp_country_code")}-${str("emp_number")}`),
    client_name: str("client_name") || null,
    client_number: str("client_number") ? [str("client_country_code"),str("client_number")].filter(Boolean).join("-") : null,
    occurred_at: occurred, duration_seconds: duration, call_type: type, call_method: stream.method, call_mode: stream.mode,
    provider_synced_at: callyzerTime(row.synced_at), provider_modified_at: callyzerTime(row.modified_at),
  };
}

export function importCoverage(options: {
  number: string | null; trackingSince: string | null; configured: boolean; state: SyncState | null;
  device: CallyzerDevice | null;
  from: string | null; to: string | null; channel?: CallyzerChannel; now?: Date;
}): { label: string; detail: string; showCounts: boolean; through: string | null } {
  const { number, state, trackingSince, from, to, configured, device } = options;
  const now = (options.now || new Date()).getTime();
  const streams = CALLYZER_STREAMS.filter(s => !options.channel || options.channel === "all" || options.channel === s.key).map(s => state?.streams[s.key]);
  const present = streams.filter((s): s is StreamProgress => !!s);
  const through = present.length === streams.length && present.every(s => s.backfilled) ? new Date(Math.min(...present.map(s => s.through)) * 1000).toISOString() : null;
  if (!number) return { label: "Manual only", detail: "No current Callyzer link. Previously attributed calls are retained; new automatic activity is unavailable.", showCounts: true, through };
  if (!configured) return { label: "Sync not configured", detail: "Callyzer credentials have not been configured on the server.", showCounts: true, through };
  const start = from ? Date.parse(trackingStart(from)) : -Infinity;
  if (start > now) return { label: "Future period", detail: "This period has not started. Automatic activity is unavailable.", showCounts: false, through };
  if (state?.last_error) return { label: "Sync delayed", detail: "A request failed. Received counts may be incomplete; the sync will retry automatically.", showCounts: true, through };
  if (state?.last_attempt_at && now - Date.parse(state.last_attempt_at) > 15 * 60000) return { label: "Sync delayed", detail: "No recent sync attempt. Received counts may be incomplete.", showCounts: true, through };
  if (!present.length || present.length !== streams.length || present.some(s => !s.backfilled)) return { label: "Import pending", detail: "The initial import is incomplete. Counts may increase as pages arrive.", showCounts: true, through };
  if (!device || device.found === null) return { label: "Link not checked", detail: "The employee link has not been verified. Received calls may still appear below.", showCounts: true, through };
  if (device.found === false) return { label: "Number not found", detail: "Check this caller's registered Callyzer number. Zero received calls cannot establish inactivity.", showCounts: true, through };
  if (device.app_uninstalled) return { label: "App uninstalled", detail: "Callyzer reports that the phone app is uninstalled. New device activity may be missing.", showCounts: true, through };
  if (device.logging_enabled === false) return { label: "Device logging off", detail: "Callyzer reports that call logging is disabled. New device activity may be missing.", showCounts: true, through };
  const firstCovered = Math.max(...present.map(s => s.since * 1000), trackingSince ? Date.parse(trackingSince) : 0);
  const end = Math.min(now - 120000, to ? Date.parse(trackingStart(to)) + 86400000 : now);
  const delayed = !!state?.last_error || !state?.last_success_at || now - Date.parse(state.last_success_at) > 15 * 60000;
  const partial = start < firstCovered || end > Date.parse(through!) + 10 * 60000 || !!to && to > indiaDate(new Date(now));
  return { label: delayed ? "Sync delayed" : partial ? "Partial coverage" : "Imported",
    detail: `${partial ? "This selection extends beyond the imported or linked period. " : ""}Device uploads can be delayed; these are the calls received by Callyzer.`, showCounts: true, through };
}

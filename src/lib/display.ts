import {providerTimestamp} from './time';
export function dateTime(value: string | Date | null) {
  if (!value) return "—";
  const date=value instanceof Date?value:new Date(providerTimestamp(value)??NaN);
  if(!Number.isFinite(date.getTime()))return "—";
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) + " IST";
}
export function shortDate(value: string | Date | null) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(providerTimestamp(value) ?? NaN);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit", timeZone: "Asia/Kolkata" });
}
export function personName(name: string | null | undefined, email: string) {
  return (name?.trim() || email).split('@')[0] || 'Unknown';
}
export function rent(value: string | null) {
  if (!value) return "—";
  const digits = value.replace(/[,\s₹]/g, "");
  return /^\d+(?:\.\d+)?$/.test(digits) && Number.isFinite(Number(digits)) ? `₹${Number(digits).toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : value;
}
export function area(value: string | number | null) {
  return value && Number.isFinite(Number(value)) ? `${Number(value).toLocaleString("en-IN")} sqft` : "—";
}
export function resultClass(value: string | null) {
  const v = (value ?? "unclear").toLowerCase();
  if (v.startsWith("dead")) return "dead";
  return ["available", "unavailable", "unclear", "open", "done", "dropped"].includes(v) ? v : "unclear";
}

export function number(value: string | number | null) {
  if (value == null || value === "") return "—";
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString("en-IN") : String(value);
}

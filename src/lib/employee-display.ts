export function dateTime(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) + " IST";
}
export function rent(value: string | null) {
  if (!value) return "—";
  const digits = value.replace(/[,\s₹]/g, "");
  return /^\d+$/.test(digits) ? `₹${Number(digits).toLocaleString("en-IN")}` : value;
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

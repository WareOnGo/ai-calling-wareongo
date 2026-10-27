import { request } from "node:https";

export class CallyzerError extends Error {
  constructor(message: string, public retryAfterMs = 0, public status: number | null = null) { super(message); }
}
export type CallyzerResponse = { result: unknown[]; page_no?: number; page_size?: number; total_records?: number };
export type CallyzerRequest = (path: "call-log/history" | "employee/get", body: Record<string, unknown>) => Promise<CallyzerResponse>;

/** GET /employee/get requires a JSON body. Native fetch forbids that, so use Node HTTPS. */
export const requestCallyzer: CallyzerRequest = async (path, body) => {
  const token = process.env.CALLYZER_API_TOKEN?.trim();
  if (!token) throw new CallyzerError("Callyzer token is not configured");
  const base = process.env.CALLYZER_BASE_URL || "https://api1.callyzer.co/api/v2.2/";
  if (!["https://api1.callyzer.co/api/v2.2/", "https://sandbox.api.callyzer.co/api/v2.2/"].includes(base)) throw new CallyzerError("Unsupported Callyzer API base URL");
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request(new URL(path, base), { method: path === "employee/get" ? "GET" : "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), Accept: "application/json" },
    }, res => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 4 * 1024 * 1024) req.destroy(new CallyzerError("Callyzer response exceeded size limit"));
        else chunks.push(chunk);
      });
      res.on("error", () => reject(new CallyzerError("Callyzer response interrupted")));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          const raw = res.headers["retry-after"];
          const seconds = typeof raw === "string" ? Number(raw) : NaN;
          const retry = Number.isFinite(seconds) ? seconds * 1000 : typeof raw === "string" ? Date.parse(raw) - Date.now() : 0;
          reject(new CallyzerError(`Callyzer HTTP ${res.statusCode || "error"}`, Math.max(0, Number.isFinite(retry) ? retry : 0),res.statusCode || null));
          return;
        }
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (!parsed || !Array.isArray(parsed.result)) throw new Error();
          resolve(parsed);
        } catch { reject(new CallyzerError("Invalid Callyzer response")); }
      });
    });
    // Absolute deadline includes DNS, connection establishment and streamed response time.
    const timer = setTimeout(() => req.destroy(new CallyzerError("Callyzer request timed out")), 12000);
    req.on("close", () => clearTimeout(timer));
    req.on("error", error => reject(error instanceof CallyzerError ? error : new CallyzerError("Callyzer connection failed")));
    req.end(data);
  });
};

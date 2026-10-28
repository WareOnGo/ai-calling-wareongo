import { z } from "zod";
import { getPool } from "./db";
import { ApiError, jsonBody, uuid } from "./api";
import { csvCell } from "./csv";

export const EXPORT_CAP = 100000;
export const exportSchema = z.object({
  ids: z.array(uuid).min(1).max(EXPORT_CAP).transform(v => [...new Set(v)]).optional(),
  filters: z.record(z.unknown()).default({}),
}).strict();
export async function exportInput(req: Request) {
  if (req.method === "POST") return jsonBody(req, exportSchema);
  const params = new URL(req.url).searchParams;
  return exportSchema.parse({ ids: params.has("ids") ? params.get("ids")!.split(",") : undefined, filters: Object.fromEntries(params) });
}

export type ExportQuery = { sql: string; countSql: string; params: unknown[]; countParams: unknown[] };
export async function csvResponse<T>(spec: ExportQuery, columns: { label: string; get: (row: T) => unknown }[], filename: string): Promise<Response> {
  const client = await getPool().connect();
  let released = false;
  const close = async () => {
    if (released) return;
    released = true;
    try { await client.query("rollback"); } finally { client.release(); }
  };
  try {
    // Count and cursor see the same data. There is no silent selection truncation,
    // and FETCH bounds memory even when exporting the entire source dataset.
    await client.query("begin isolation level repeatable read read only");
    const count = await client.query(spec.countSql, spec.countParams);
    if (Number(count.rows[0].n) > EXPORT_CAP) throw new ApiError(413, `Export exceeds ${EXPORT_CAP.toLocaleString()} rows. Narrow your filters.`);
    await client.query(`declare bolna_export no scroll cursor for ${spec.sql}`, spec.params);
    const encoder = new TextEncoder();
    let header = true;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (header) { header = false; controller.enqueue(encoder.encode("\uFEFF" + columns.map(c => csvCell(c.label)).join(",") + "\r\n")); return; }
          const result = await client.query("fetch forward 250 from bolna_export");
          if (!result.rowCount) { await close(); controller.close(); return; }
          controller.enqueue(encoder.encode(result.rows.map(row => columns.map(c => csvCell(c.get(row as T))).join(",")).join("\r\n") + "\r\n"));
        } catch (error) { try { await close(); } finally { controller.error(error); } }
      },
      async cancel() { await close(); },
    });
    return new Response(stream, { headers: {
      "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store", "x-export-row-count": String(count.rows[0].n),
    } });
  } catch (error) { await close(); throw error; }
}

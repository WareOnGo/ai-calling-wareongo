import { z } from "zod";
import { query, transaction } from "./db";
import { executionSchema, isTerminal } from "./bolna";
import { applyExecutionSnapshots } from "./apply-execution-snapshots";

const PAGE_SIZE = 100;
const pageSchema = z.object({ page_number: z.number().int(), total: z.number().int().nonnegative().max(80000),
  has_more: z.boolean(), data: z.array(executionSchema).max(PAGE_SIZE) });
type Progress = { phase: "retained" | "provider"; page: number; scanned: number; wouldUpdate: number; written: number };

class ProviderReadError extends Error {
  constructor(readonly status: number) { super(`Provider history read failed (${status})`); }
}
async function providerGet(path: string): Promise<unknown> {
  if (!process.env.BOLNA_API_KEY) throw new Error("BOLNA_API_KEY is required");
  const result = await fetch(`https://api.bolna.ai${path}`, { method: "GET", cache: "no-store",
    headers: { Authorization: `Bearer ${process.env.BOLNA_API_KEY}` }, signal: AbortSignal.timeout(45000) });
  if (!result.ok) throw new ProviderReadError(result.status);
  // Older provider deployments expose only the array endpoint. Bound that read
  // as well as its subsequent database pages instead of buffering unbounded data.
  const chunks: Uint8Array[] = []; let bytes = 0;
  const reader = result.body?.getReader();
  if (!reader) throw new Error("Provider returned an empty response");
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 100 * 1024 * 1024) throw new Error("Provider history exceeds the 100 MiB recovery limit");
      chunks.push(part.value);
    }
  } finally { await reader.cancel(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function* providerPages(providerId: string) {
  const base = encodeURIComponent(providerId);
  let first: unknown;
  try { first = await providerGet(`/v2/batches/${base}/executions?page_number=1&page_size=${PAGE_SIZE}`); }
  catch (error) {
    if (!(error instanceof ProviderReadError) || ![404, 405].includes(error.status)) throw error;
    const rows = z.array(executionSchema).max(80000).parse(await providerGet(`/batches/${base}/executions`));
    if (rows.some(row => row.batch_id !== providerId)) throw new Error("Provider returned executions outside this batch");
    for (let offset = 0; offset < rows.length; offset += PAGE_SIZE) {
      yield { page_number: offset / PAGE_SIZE + 1, total: rows.length, has_more: offset + PAGE_SIZE < rows.length, data: rows.slice(offset, offset + PAGE_SIZE) };
    }
    return;
  }
  for (let number = 1; number <= 800; number++) {
    const page = pageSchema.parse(number === 1 ? first : await providerGet(`/v2/batches/${base}/executions?page_number=${number}&page_size=${PAGE_SIZE}`));
    if (page.page_number !== number || (page.has_more && !page.data.length)) throw new Error("Provider returned invalid history pagination");
    yield page;
    if (!page.has_more) return;
  }
  throw new Error("Recovery page limit reached; narrow the batch before retrying");
}

/** Operator recovery: provider GETs only; never changes scheduling, reservations or assignments. */
export async function recoverBatchHistory(id: string, options: { apply?: boolean; progress?: (p: Progress) => void } = {}) {
  z.string().uuid().parse(id);
  const batch = (await query<{ bolna_batch_id: string | null; agent_id: string }>(
    "select bolna_batch_id,agent_id from call_batches where id=$1", [id])).rows[0];
  if (!batch?.bolna_batch_id) throw new Error("An existing batch with a saved provider ID is required");
  const providerId = batch.bolna_batch_id;
  const remote = z.object({ batch_id: z.string(), status: z.string() }).parse(await providerGet(`/batches/${encodeURIComponent(providerId)}`));
  if (remote.batch_id !== providerId) throw new Error("Provider returned a different batch");
  const report = { apply: !!options.apply, batchId: id, providerBatchId: providerId, providerState: remote.status,
    retainedSnapshots: 0, providerExecutions: 0, terminalExecutions: 0, wouldUpdate: 0, written: 0, deferred: 0, pages: 0 };

  // Retain known older dials BEFORE a newer provider snapshot replaces the inbox.
  // Each source is unique by execution ID, and every committed page is replayable.
  for (const source of ["bolna_call_logs", "bolna_webhook_events"] as const) {
    let cursor: string | null = null, page = 0;
    while (true) {
      const rows: { id: string; raw: unknown }[] = (await query<{ id: string; raw: unknown }>(`select id,raw from ${source}
        where ${source === "bolna_call_logs" ? "batch_id" : "raw->>'batch_id'"}=$1
          and raw is not null and ($2::uuid is null or id>$2::uuid) order by id limit 100`, [providerId, cursor])).rows;
      if (!rows.length) break;
      const payloads = rows.map(row => executionSchema.parse(row.raw));
      if (payloads.some(e => e.batch_id !== providerId)) throw new Error("Retained snapshot belongs to a different batch");
      if (options.apply) await transaction(async client => {
        await client.query("select bolna_record_ai_evidence(value,'recovery-retained') from jsonb_array_elements($1::jsonb)", [JSON.stringify(payloads)]);
      });
      report.retainedSnapshots += rows.length; cursor = rows.at(-1)!.id;
      options.progress?.({ phase: "retained", page: ++page, scanned: report.retainedSnapshots, wouldUpdate: 0, written: 0 });
    }
  }

  for await (const page of providerPages(providerId)) {
    if (page.data.some(e => e.batch_id !== providerId || (e.agent_id != null && e.agent_id !== batch.agent_id))) throw new Error("Provider returned executions outside this batch");
    if (new Set(page.data.map(e => e.id)).size !== page.data.length) throw new Error("Provider returned duplicate execution IDs in a page");
    const terminal = page.data.filter(e => isTerminal(e.status));
    const delta = await transaction(async client => {
      if (!options.apply) await client.query("set transaction read only");
      const wouldUpdate = Number((await client.query(`select count(*) n from jsonb_array_elements($1::jsonb) p
        left join bolna_call_logs c on c.id=(p->>'id')::uuid where bolna_execution_newer(p,c.raw)`, [JSON.stringify(terminal)])).rows[0].n);
      if (!options.apply) return { wouldUpdate, written: 0, deferred: 0 };
      return { wouldUpdate, ...await applyExecutionSnapshots(client, page.data, "recovery-provider") };
    });
    report.providerExecutions += page.data.length; report.terminalExecutions += terminal.length;
    report.wouldUpdate += delta.wouldUpdate; report.written += delta.written; report.deferred += delta.deferred; report.pages++;
    options.progress?.({ phase: "provider", page: page.page_number, scanned: report.providerExecutions, wouldUpdate: report.wouldUpdate, written: report.written });
  }
  return report;
}

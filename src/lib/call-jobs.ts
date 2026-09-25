import { randomUUID } from "node:crypto";
import { query, transaction } from "./db";
import { ApiError, envInt } from "./api";
import { ENABLE_ENRICHMENT, MIN_COST_CENTS } from "./inference";
import { INFERENCE_VERSION, inferCall, inferDistrict } from "./openai";
import { writeInference } from "./enrich";
import type { Viewer } from "./scope";

export type JobKind = "inference" | "district";
export type CallJob = {
  id: string; kind: JobKind; transcript: string | null; city_area: string | null;
  input_hash: string; version: number; lease_token: string; attempts: number;
};
// Include every input that can affect eligibility or the generated output.
export function inputHash(kind: JobKind): string {
  return kind === "inference"
    ? "md5(jsonb_build_array(c.transcript, c.status, c.total_cost)::text)"
    : "md5(jsonb_build_array(c.transcript, c.city_area, c.context_details -> 'recipient_data' ->> 'area')::text)";
}

export async function claimCallJob(kind: JobKind, id?: string, force = false, viewer?: Viewer): Promise<CallJob | undefined> {
  if (!ENABLE_ENRICHMENT) return undefined;
  const version = kind === "inference" ? INFERENCE_VERSION : 1;
  const hash = inputHash(kind);
  const eligibility = kind === "inference"
    ? `c.status in ('completed', 'call-disconnected') and c.total_cost > $3
       and length(trim(coalesce(c.transcript, ''))) > 0 and c.inference_version <= $2
       and ($5 or not c.enriched or c.inference_version < $2)`
    : `nullif(trim(c.context_details -> 'recipient_data' ->> 'area'), '') is null and c.inferred_district is null
       and (length(trim(coalesce(c.transcript, ''))) > 20 or length(trim(coalesce(c.city_area, ''))) > 0)`;
  return transaction(async client => {
    const res = await client.query(`select c.id, c.transcript, c.city_area, ${hash} as input_hash
      from bolna_call_logs c left join bolna_call_jobs j on j.call_id = c.id and j.kind = $1
      where ${eligibility} and ($4::uuid is null or c.id = $4)
      and ($6::text is null or exists (select 1 from bolna_assignments a where a.entity_type = 'call'
           and a.entity_id = c.id and a.assignee = $6 and a.state = 'open'))
      and (j.call_id is null or j.version <= $2)
      and (j.call_id is null or j.input_hash <> ${hash} or j.version < $2 or
           (j.version = $2 and coalesce(j.lease_until, '-infinity') <= now()
             and ($5 or (j.completed_at is null and j.attempts < 8 and j.available_at <= now()))))
      order by c.total_cost desc nulls last, c.id for update of c skip locked limit 1`,
    [kind, version, MIN_COST_CENTS, id ?? null, force, viewer && !viewer.isAdmin ? viewer.email.toLowerCase() : null]);
    const row = res.rows[0];
    if (!row) return undefined;
    const token = randomUUID();
    const claimed = await client.query(`insert into bolna_call_jobs(call_id, kind, input_hash, version, attempts, lease_token, lease_until)
      values ($1, $2, $3, $4, 1, $5, now() + interval '120 seconds')
      on conflict(call_id, kind) do update set input_hash = excluded.input_hash, version = excluded.version,
        attempts = case when bolna_call_jobs.input_hash <> excluded.input_hash or bolna_call_jobs.version <> excluded.version or $6
                   then 1 else bolna_call_jobs.attempts + 1 end,
        lease_token = excluded.lease_token, lease_until = excluded.lease_until, completed_at = null, last_error = null
      returning attempts`, [row.id, kind, row.input_hash, version, token, force]);
    return { ...row, kind, version, lease_token: token, attempts: claimed.rows[0].attempts } as CallJob;
  });
}

export async function runCallJob(job: CallJob) {
  try {
    const result = job.kind === "inference" ? await inferCall(job.transcript) : await inferDistrict(job.transcript, job.city_area);
    return await transaction(async client => {
      // Lock order matches claiming: call first, then job. The lease token and input
      // fingerprint fence a timed-out worker and a transcript edited during inference.
      const call = await client.query(`select c.id from bolna_call_logs c where c.id = $1
        and ${inputHash(job.kind)} = $2 and ($3::integer is null or c.inference_version <= $3) for update`, [job.id, job.input_hash, job.kind === "inference" ? job.version : null]);
      const lease = await client.query(`select call_id from bolna_call_jobs where call_id = $1 and kind = $2
        and lease_token = $3 and lease_until > now() and version = $4 for update`, [job.id, job.kind, job.lease_token, job.version]);
      if (!call.rowCount || !lease.rowCount) return { ok: false as const, reason: "superseded" };
      let fields;
      if ("availability" in result) fields = await writeInference(client, job.id, result);
      else await client.query(`update bolna_call_logs set inferred_district = $2 where id = $1`, [job.id, result.district ?? ""]);
      await client.query(`update bolna_call_jobs set completed_at = now(), lease_token = null, lease_until = null, last_error = null
        where call_id = $1 and kind = $2 and lease_token = $3`, [job.id, job.kind, job.lease_token]);
      return { ok: true as const, fields };
    });
  } catch (error) {
    try {
      await query(`update bolna_call_jobs set last_error = $4, available_at = now() + $5 * interval '1 minute',
        lease_token = null, lease_until = null where call_id = $1 and kind = $2 and lease_token = $3`,
      [job.id, job.kind, job.lease_token, String(error).slice(0, 1000), Math.min(2 ** job.attempts, 60)]);
    } catch (failure) { console.error("[inference] could not record failure; lease will expire", failure); }
    throw error;
  }
}

export async function runCallJobs(kind: JobKind) {
  if (!ENABLE_ENRICHMENT) return { disabled: true, claimed: 0, succeeded: 0, failed: 0 };
  const limit = envInt(kind === "inference" ? "ENRICH_BATCH_SIZE" : "DISTRICT_BATCH_SIZE", 24, 100);
  const concurrency = envInt("ENRICH_CONCURRENCY", 4, 4);
  const deadline = Date.now() + 230_000;
  let started = 0, claimed = 0, succeeded = 0, failed = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (started < limit && Date.now() < deadline) {
      started++;
      const job = await claimCallJob(kind);
      if (!job) break;
      claimed++;
      try { if ((await runCallJob(job)).ok) succeeded++; else failed++; }
      catch (error) { failed++; console.error(`[${kind}] ${job.id} failed`, error); }
    }
  }));
  return { claimed, succeeded, failed };
}

export async function enrichCallById(id: string, viewer: Viewer, force = false) {
  if (!ENABLE_ENRICHMENT) throw new ApiError(409, "Enrichment is disabled");
  if (force && !viewer.isAdmin) throw new ApiError(403, "Only admins can force inference");
  const job = await claimCallJob("inference", id, force, viewer);
  if (!job) throw new ApiError(409, "Call is not eligible, already inferred, being processed, or waiting for retry");
  return runCallJob(job);
}

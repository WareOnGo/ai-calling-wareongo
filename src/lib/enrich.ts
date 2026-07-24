import { getPool } from "@/lib/db";
import { inferCall, type Inference } from "@/lib/openai";
import { inferenceFields } from "@/lib/inference";

// Fields the enrich write returns to the caller so the client can reflect them
// without a full refetch.
export type EnrichedFields = {
  availability: string | null;
  built_up_area_sqft: string | null;
  city_area: string | null;
  expected_rent: string | null;
  possession: string | null;
  confidence: string | null;
  notes: string | null;
  needs_review: boolean;
};

// Write an inference result back onto a call row. Shared by the bulk /api/enrich
// pass and the per-row "Infer" button so their update logic can't drift.
export async function writeInference(id: string, inf: Inference): Promise<EnrichedFields> {
  const f = inferenceFields(inf);
  await getPool().query(
    `update bolna_call_logs set
       llm_availability   = $2,
       built_up_area_sqft = $3,
       city_area          = $4,
       expected_rent      = $5,
       possession         = $6,
       confidence         = $7,
       notes              = $8,
       enrichment         = $9,
       enriched           = true,
       inference_version  = $10,
       inference_model    = $11,
       needs_review       = $12,
       processed_at       = now()
     where id = $1`,
    [
      id,
      f.llm_availability,
      f.built_up_area_sqft,
      f.city_area,
      f.expected_rent,
      f.possession,
      f.confidence,
      f.notes,
      f.inference,
      f.inference_version,
      f.inference_model,
      f.needs_review,
    ],
  );
  return {
    availability: f.llm_availability,
    built_up_area_sqft: f.built_up_area_sqft,
    city_area: f.city_area,
    expected_rent: f.expected_rent,
    possession: f.possession,
    confidence: f.confidence,
    notes: f.notes,
    needs_review: f.needs_review,
  };
}

export type EnrichResult =
  | { ok: true; fields: EnrichedFields }
  | { ok: false; reason: "not_found" };

// Enrich a single call by id: fetch its transcript, run OpenAI, persist. Throws
// on OpenAI/DB failure so the caller can surface the error to the user.
export async function enrichCallById(id: string): Promise<EnrichResult> {
  const { rows } = await getPool().query<{ transcript: string | null }>(
    `select transcript from bolna_call_logs where id = $1`,
    [id],
  );
  if (rows.length === 0) return { ok: false, reason: "not_found" };
  const inf = await inferCall(rows[0].transcript);
  const fields = await writeInference(id, inf);
  return { ok: true, fields };
}

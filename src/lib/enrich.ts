import type { PoolClient } from "pg";
import { type Inference } from "@/lib/openai";
import { inferenceFields } from "@/lib/inference";

// Fields the enrich write returns to the caller so the client can reflect them
// without a full refetch.
export type EnrichedFields = {
  availability: string | null;
  built_up_area_sqft: string | null;
  carpet_area_sqft: string | null;
  city_area: string | null;
  expected_rent: string | null;
  possession: string | null;
  confidence: string | null;
  notes: string | null;
  needs_review: boolean;
};

// Called only inside a fenced job transaction. Write an inference result back onto a call row. Shared by the bulk /api/enrich
// pass and the per-row "Infer" button so their update logic can't drift.
export async function writeInference(client: PoolClient, id: string, inf: Inference): Promise<EnrichedFields> {
  const f = inferenceFields(inf);
  await client.query(
    `update bolna_call_logs set
       llm_availability   = $2,
       built_up_area_sqft = $3,
       carpet_area_sqft   = $13,
       city_area          = $4,
       inferred_district  = case when city_area is distinct from $4 then null else inferred_district end,
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
      f.carpet_area_sqft,
    ],
  );
  return {
    availability: f.llm_availability,
    built_up_area_sqft: f.built_up_area_sqft,
    carpet_area_sqft: f.carpet_area_sqft,
    city_area: f.city_area,
    expected_rent: f.expected_rent,
    possession: f.possession,
    confidence: f.confidence,
    notes: f.notes,
    needs_review: f.needs_review,
  };
}

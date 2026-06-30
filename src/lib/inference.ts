import { type Inference, INFERENCE_VERSION, MODEL } from "./openai";

// Cost gate: only infer calls whose total_cost (cents) exceeds this.
export const MIN_COST_CENTS = Number(process.env.INFERENCE_MIN_COST_CENTS || "0.04");

// Master switch for the LLM step (live path). When false, store call data only.
export const ENABLE_ENRICHMENT = process.env.ENABLE_ENRICHMENT !== "false";

// Statuses that represent a call that actually connected and had a conversation.
// Bolna reports many real conversations as 'call-disconnected', so it counts too.
export const CONNECTED_STATUSES = ["completed", "call-disconnected"];
const CONNECTED_SQL = "('completed', 'call-disconnected')";

/**
 * A call qualifies for LLM inference only if it actually connected
 * (completed / call-disconnected), spent more than the cost gate, and has a transcript.
 * Non-connected calls are handled deterministically by the bolna_call_analysis view.
 */
export function qualifiesForInference(
  status: string | null | undefined,
  totalCost: number | null | undefined,
  transcript: string | null | undefined,
): boolean {
  return (
    CONNECTED_STATUSES.includes(status ?? "") &&
    (totalCost ?? 0) > MIN_COST_CENTS &&
    !!transcript &&
    transcript.trim().length > 0
  );
}

// SQL-shaped column values derived from an inference result (or null if not run).
export function inferenceFields(inf: Inference | null) {
  return {
    llm_availability: inf?.availability ?? null,
    built_up_area_sqft: inf?.built_up_area_sqft ?? null,
    city_area: inf?.city_area ?? null,
    expected_rent: inf?.expected_rent ?? null,
    possession: inf?.possession ?? null,
    confidence: inf?.confidence ?? null,
    notes: inf?.notes ?? null,
    inference: inf, // raw object -> jsonb (enrichment column)
    enriched: inf != null,
    inference_version: inf != null ? INFERENCE_VERSION : 0,
    inference_model: inf != null ? MODEL : null,
    needs_review: inf != null ? inf.confidence === "Low" : false,
  };
}

// SQL predicate (and the matching params) for "needs inference at the current version".
export const NEEDS_INFERENCE_SQL = `
  status in ${CONNECTED_SQL}
  and total_cost > $1
  and length(trim(coalesce(transcript, ''))) > 0
  and (enriched = false or inference_version < $2)
`;
export const needsInferenceParams = [MIN_COST_CENTS, INFERENCE_VERSION];

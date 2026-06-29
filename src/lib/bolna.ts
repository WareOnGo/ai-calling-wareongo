import { z } from "zod";

// Statuses that mean "the call is over" — only these get processed.
// (Mirrors the AgentExecution status enum in Bolna's Get Execution API.)
export const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "busy",
  "no-answer",
  "canceled",
  "stopped",
  "error",
  "balance-low",
  "call-disconnected",
]);

export function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

// Loose schema: validates the fields we use, passes through everything else
// so we never reject a payload just because Bolna added a new field.
export const telephonySchema = z
  .object({
    // Docs say string, but the live API returns a number — accept both.
    duration: z.union([z.string(), z.number()]).nullish(),
    to_number: z.string().nullish(),
    from_number: z.string().nullish(),
    recording_url: z.string().nullish(),
    call_type: z.string().nullish(),
    hangup_by: z.string().nullish(),
    hangup_reason: z.string().nullish(),
  })
  .passthrough();

export const executionSchema = z
  .object({
    id: z.string().uuid(),
    agent_id: z.string().nullish(),
    batch_id: z.string().nullish(),
    status: z.string(),
    total_cost: z.number().nullish(),
    cost_breakdown: z.record(z.any()).nullish(),
    transcript: z.string().nullish(),
    answered_by_voice_mail: z.boolean().nullish(),
    extracted_data: z.record(z.any()).nullish(),
    context_details: z.record(z.any()).nullish(),
    created_at: z.string().nullish(),
    telephony_data: telephonySchema.nullish(),
  })
  .passthrough();

export type Execution = z.infer<typeof executionSchema>;

// Flatten + clean the raw payload into the shape we store in bolna_call_logs.
export function normalize(e: Execution) {
  const t = e.telephony_data ?? {};
  const duration = t.duration != null ? Math.trunc(Number(t.duration)) : null;

  return {
    id: e.id,
    agent_id: e.agent_id ?? null,
    batch_id: e.batch_id ?? null,
    status: e.status,
    call_type: t.call_type ?? null,
    from_number: t.from_number ?? null,
    to_number: t.to_number ?? null,
    duration_secs: Number.isFinite(duration) ? duration : null,
    total_cost: e.total_cost ?? null,
    cost_breakdown: e.cost_breakdown ?? null,
    recording_url: t.recording_url ?? null,
    hangup_by: t.hangup_by ?? null,
    hangup_reason: t.hangup_reason ?? null,
    answered_by_vm: e.answered_by_voice_mail ?? null,
    transcript: e.transcript?.trim() || null,
    context_details: e.context_details ?? null,
    call_created_at: e.created_at ?? null,
  };
}

export type NormalizedCall = ReturnType<typeof normalize>;

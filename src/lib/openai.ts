import OpenAI from "openai";

const globalForAI = globalThis as unknown as { __openai?: OpenAI };

function client(): OpenAI {
  if (!globalForAI.__openai) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not set");
    }
    globalForAI.__openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return globalForAI.__openai;
}

export const MODEL = process.env.OPENAI_MODEL || "gpt-4o";

// Bump when the prompt/schema changes — lets us re-infer only stale rows
// (select where inference_version < INFERENCE_VERSION).
export const INFERENCE_VERSION = 1;

// Property-verification inference fields (modeled on the GW call-log-inference skill).
export type Inference = {
  availability: "Available" | "Unavailable" | "Unclear";
  built_up_area_sqft: string;
  city_area: string;
  expected_rent: string;
  possession: string;
  confidence: "High" | "Medium" | "Low";
  notes: string;
};

export const EMPTY_INFERENCE: Inference = {
  availability: "Unclear",
  built_up_area_sqft: "",
  city_area: "",
  expected_rent: "",
  possession: "",
  confidence: "Low",
  notes: "",
};

const SYSTEM_PROMPT = `You analyze transcripts of outbound phone calls where an AI agent named Priya cold-calls warehouse / property owners in India (Hindi / Hinglish / Devanagari, often noisy ASR) to verify a property listing. Priya asks whether the property is available for rent, its built-up area, the locality, the expected rent, and the possession timeline.

From the transcript, extract:
- availability: "Available" if the owner confirms the property is available to rent; "Unavailable" if it is not available / already rented / the person is not the owner of an available property; "Unclear" if it cannot be determined (no answer, off-topic, call dropped before the question was answered). A bare "हां" / "haan" / "yes" / "है" right after the availability question counts as Available.
- built_up_area_sqft: the built-up / carpet area as DIGITS in square feet. Convert spoken Indian numbers ("forty five hundred" -> 4500, "बीस हज़ार" -> 20000, "saade teen hazaar" -> 3500). "" if not stated.
- city_area: locality / area / landmark mentioned. "" if none.
- expected_rent: rent WITH its unit preserved ("1 lakh per month", "13 rs/sqft"). "" if not stated or the owner declined to quote.
- possession: "Ready" if available now; "Time needed" if only after some time; "" if not stated.
- confidence: High / Medium / Low — your confidence in the availability verdict and the numeric fields. Use Low for spoken-number guesses and ambiguous transcripts.
- notes: ONE short sentence justifying the verdict so a human can audit without reopening the recording.

Base everything strictly on the transcript. Never invent values. If the transcript is empty or only the agent greeting with no owner response, return availability "Unclear", empty fields, confidence "Low".`;

/**
 * Infer property-verification fields from a call transcript with OpenAI.
 * Throws on API failure so the caller can mark the row for retry.
 */
export async function inferCall(transcript: string | null): Promise<Inference> {
  if (!transcript || transcript.trim().length < 5) {
    return { ...EMPTY_INFERENCE, notes: "Empty or near-empty transcript." };
  }

  const completion = await client().chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Transcript:\n\n${transcript}` },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "property_inference",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            availability: { type: "string", enum: ["Available", "Unavailable", "Unclear"] },
            built_up_area_sqft: { type: "string", description: "Digits in sqft, or empty string." },
            city_area: { type: "string" },
            expected_rent: { type: "string", description: "Rent with unit preserved, or empty string." },
            possession: { type: "string", description: '"Ready", "Time needed", or empty string.' },
            confidence: { type: "string", enum: ["High", "Medium", "Low"] },
            notes: { type: "string" },
          },
          required: [
            "availability",
            "built_up_area_sqft",
            "city_area",
            "expected_rent",
            "possession",
            "confidence",
            "notes",
          ],
        },
      },
    },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned empty content");
  return JSON.parse(content) as Inference;
}

// ---- District inference (fill db_area when the source DB didn't provide one) ----

export type DistrictResult = { district: string; confidence: "High" | "Medium" | "Low" };

const DISTRICT_PROMPT = `You are given a property-verification call (Hindi / Hinglish / Devanagari, noisy ASR) and an optional noisy locality string. Identify the Indian DISTRICT (or the major city, if a district isn't clear) where the property is located, using any landmark, locality, area, railway station, or city mention.

Return the clean district/city name in Title Case with standard English spelling (e.g. "Patna", "Jamshedpur", "Samastipur", "New Delhi"). Do NOT return a bare landmark or colony — map it to its district/city. If it genuinely cannot be determined, return an empty string. Also return your confidence.`;

export async function inferDistrict(
  transcript: string | null,
  cityArea: string | null,
): Promise<DistrictResult> {
  const signal = [
    cityArea ? `Locality hint: ${cityArea}` : "",
    transcript ? `Transcript:\n${transcript}` : "",
  ].filter(Boolean).join("\n\n");
  if (signal.trim().length < 5) return { district: "", confidence: "Low" };

  const completion = await client().chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: DISTRICT_PROMPT },
      { role: "user", content: signal },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "district_inference",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            district: { type: "string", description: "District/city in Title Case, or empty string." },
            confidence: { type: "string", enum: ["High", "Medium", "Low"] },
          },
          required: ["district", "confidence"],
        },
      },
    },
  });
  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned empty content");
  return JSON.parse(content) as DistrictResult;
}

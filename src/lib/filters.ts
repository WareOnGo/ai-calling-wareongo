import { z } from "zod";
const optional = <S extends z.ZodTypeAny>(schema: S) => z.preprocess(v => v === "" || v === null ? undefined : v, schema.optional());
const text = optional(z.string().max(1000));
const flag = z.preprocess(v => v === "1" || v === "true" ? true : v === "0" || v === "false" ? false : v === "" || v === null ? undefined : v, z.boolean().optional());
const area = optional(z.union([z.number(), z.string().regex(/^\d+(\.\d+)?$/).transform(Number)]).pipe(z.number().finite().nonnegative()));
const common = { q: text, source: text, state: text, contact: optional(z.enum(["broker", "owner"])), assignee: text };
export const rawFiltersSchema = z.object({ ...common,
  city: text, warehouse_type: text, called: optional(z.enum(["yes", "no"])), last_result: text,
  min_area: area, max_area: area, has_phone: flag,
}).refine(f => f.min_area == null || f.max_area == null || f.min_area <= f.max_area, "Minimum area cannot exceed maximum area");
export const callFiltersSchema = z.object({ ...common,
  availability: text, agent_id: text, status: text, call_type: optional(z.enum(["inbound", "outbound"])),
  date_from: optional(z.string().date()), date_to: optional(z.string().date()), needs_review: flag,
}).refine(f => !f.date_from || !f.date_to || f.date_from <= f.date_to, "Start date cannot follow end date");
export const toRawFilters = (value: unknown) => rawFiltersSchema.parse(value);
export const toCallFilters = (value: unknown) => callFiltersSchema.parse(value);

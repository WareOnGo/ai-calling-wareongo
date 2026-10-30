import { z } from "zod";
import { DISPOSITIONS } from "./manual-dispositions";
const optional = <S extends z.ZodTypeAny>(schema: S) => z.preprocess(v => v === "" || v === null ? undefined : v, schema.optional());
const text = optional(z.string().max(1000));
const multiple = optional(z.union([z.string().trim().max(1000),z.array(z.string().trim().min(1).max(1000)).max(100)]).transform(v=>Array.isArray(v)?[...new Set(v)]:v));
const choices = (allowed:string[]) => multiple.refine(v=>(Array.isArray(v)?v:v?[v]:[]).every(value=>allowed.includes(value)),"Unknown filter option");
const flag = z.preprocess(v => v === "1" || v === "true" ? true : v === "0" || v === "false" ? false : v === "" || v === null ? undefined : v, z.boolean().optional());
const area = optional(z.union([z.number(), z.string().regex(/^\d+(\.\d+)?$/).transform(Number)]).pipe(z.number().finite().nonnegative()));
const yesNo = optional(z.enum(["yes", "no"]));
const reporting = { warehouse_match: yesNo, added_to_db: yesNo, wh_id: text, has_notes: yesNo, has_manual_calls: yesNo, manual_disposition: choices(["none", ...DISPOSITIONS]) };
const common = {q:text,source:multiple,state:multiple,contact:choices(["broker","owner"]),assignee:multiple,
  assignment_state:optional(z.enum(["unassigned","open","done","never"])),city:text,
  min_area:area,max_area:area,onboarded:optional(z.enum(["yes","no"])),has_ai_calls:yesNo,
  manual_outcome:choices(["none","Available","Unavailable","Unclear"]), ...reporting};
export const rawFiltersSchema=z.object({...common,warehouse_type:multiple,called:optional(z.enum(["yes","no"])),last_result:multiple,has_phone:flag,
  last_status:multiple, date_from:optional(z.string().date()),date_to:optional(z.string().date()),has_recording:yesNo,has_transcript:yesNo,
  ai_result: choices(["none", "Available", "Unavailable", "Unclear"]),
}).refine(f=>!f.date_from||!f.date_to||f.date_from<=f.date_to,"Start date cannot follow end date")
  .refine(f=>f.min_area==null||f.max_area==null||f.min_area<=f.max_area,"Minimum area cannot exceed maximum area");
export const callFiltersSchema=z.object({...common,rent_mentioned:optional(z.enum(["yes","no"])),availability:multiple,agent_id:multiple,status:multiple,call_type:choices(["inbound","outbound"]),
  has_recording: yesNo, has_transcript: yesNo, warehouse_type:multiple, has_listing:yesNo,
  area_basis:optional(z.enum(["source","built_up","carpet"])),date_from:optional(z.string().date()),date_to:optional(z.string().date()),include_blocked:flag,batch_id:text,needs_review:flag,
}).refine(f=>!f.date_from||!f.date_to||f.date_from<=f.date_to,"Start date cannot follow end date")
  .refine(f=>f.min_area==null||f.max_area==null||f.min_area<=f.max_area,"Minimum area cannot exceed maximum area");
export const toRawFilters=(value:unknown)=>rawFiltersSchema.parse(value);
export const toCallFilters=(value:unknown)=>callFiltersSchema.parse(value);

export const assignmentFiltersSchema = z.object({
  ...reporting, q: text, assignee: multiple, assigned_by: multiple, city: text, region: text, has_ai_calls:yesNo,
  comparison: optional(z.enum(["mismatch"])),
  state: choices(["open", "done", "dropped"]), type: choices(["record", "call"]),
  outcome: choices(["none", "Available", "Unavailable", "Unclear"]), ai_result: multiple,
  follow_up: optional(z.enum(["pending", "due"])), quality_review: flag,
  batch_id: optional(z.string().uuid()), date_from: optional(z.string().date()), date_to: optional(z.string().date()),
  completed_from: optional(z.string().date()), completed_to: optional(z.string().date()),
  sort: optional(z.enum(["oldest", "name"])),
}).refine(f => !f.date_from || !f.date_to || f.date_from <= f.date_to, "Start date cannot follow end date")
  .refine(f => !f.completed_from || !f.completed_to || f.completed_from <= f.completed_to, "Completion start date cannot follow end date");

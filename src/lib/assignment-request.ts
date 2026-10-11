import { z } from "zod";
import { randomUUID } from "node:crypto";
import { selectedIds, uuid } from "./api";
import { ASSIGN_CAP, allocationHash, type AllocationOptions } from "./assignment-allocation";
import { getCallIds } from "./calls";
import { getRawRecordIds } from "./raw";
import { toCallFilters, toRawFilters } from "./filters";
import type { CurrentUser } from "./auth";

export const assignmentRequestSchema=z.object({
  entity_type:z.enum(["record","call"]),assignee:z.string().trim().email().optional(),
  assignees:z.array(z.string().trim().email()).min(1).max(100).optional(),
  note:z.string().trim().max(10000).nullable().optional(),reassign:z.boolean().optional(),
  ids:selectedIds.optional(),filters:z.record(z.unknown()).optional(),
  intentKey:uuid.optional(),previewHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict().refine(v=>!!v.ids!==!!v.filters,"Provide either ids or filters")
  .refine(v=>!!v.assignee!==!!v.assignees,"Provide either one assignee or a caller list");
export type AssignmentRequest=z.infer<typeof assignmentRequestSchema>;
export function requestIdentity(body:AssignmentRequest) {
  return {intentKey:body.intentKey??randomUUID(),requestHash:allocationHash({entity:body.entity_type,
    callers:[...(body.assignees??[body.assignee!])].map(v=>v.toLowerCase()).sort(),note:body.note??null,
    reassign:!!body.reassign,ids:body.ids?[...body.ids].sort():undefined,filters:body.filters})};
}
export async function resolveAssignment(body:AssignmentRequest,admin:CurrentUser) {
  const selection=body.ids?{ids:body.ids}:{filters:body.filters};
  const resolved=body.ids?{ids:body.ids,capped:false}:body.entity_type==="call"
    ?await getCallIds(admin,toCallFilters(body.filters),ASSIGN_CAP)
    :await getRawRecordIds(admin,toRawFilters(body.filters),ASSIGN_CAP);
  const options:AllocationOptions={entity:body.entity_type,ids:resolved.ids,assignee:body.assignee,assignees:body.assignees,
    assignedBy:admin.email,note:body.note,reassign:body.reassign,selection,capped:resolved.capped,expectedPreview:body.previewHash,...requestIdentity(body)};
  return {options,capped:resolved.capped};
}

export const DISPOSITIONS = ["connected","no_answer","busy","switched_off","owner_unresponsive","callback","awaiting_confirmation","invalid_number","leased_out","no_property_for_rent"] as const;
export type Disposition = typeof DISPOSITIONS[number];
export const DISPOSITION_LABELS:Record<Disposition,string>={connected:"Connected",no_answer:"No answer / RNR",busy:"Busy",switched_off:"Switched off / unreachable",owner_unresponsive:"Owner unresponsive",callback:"Call back later",awaiting_confirmation:"Will check and get back",invalid_number:"Verified invalid number",leased_out:"Leased out",no_property_for_rent:"No property for rent"};
export const RETRY_DISPOSITIONS:readonly string[]=["no_answer","busy","switched_off","callback","awaiting_confirmation","owner_unresponsive"];
export const CONNECTED_DISPOSITIONS:readonly string[]=["connected","callback","awaiting_confirmation","leased_out","no_property_for_rent"];
export const CLOSURE_REASONS=["resolved","escalated","invalid_number_verified","exhausted"] as const;

export const dispositionLabel=(value:string|null|undefined)=>value ? DISPOSITION_LABELS[value as Disposition]||value : "No call logged";

export const allocationLabel=(value:string|null|undefined)=>value ? ({assign:"Assigned",reassign:"Reassigned",owned:"Already owned",duplicate:"Duplicate contact",missing_phone:"No usable phone",legacy:"Legacy assignment"} as Record<string,string>)[value]||value : "Not allocated";

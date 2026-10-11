// Match the indexed expressions in migration 008 exactly. All identifiers are constants.
export const rawSearch = (alias:string)=>`bolna_search_text(${alias}.owner_name,${alias}.owner_first_name,${alias}.source,${alias}.city,${alias}.state,${alias}.address,${alias}.warehouse_type,${alias}.source_record_id,${alias}.metadata->>'email',${alias}.metadata->>'pincode')`;
export const callSearch = (alias:string)=>`bolna_search_text(${alias}.from_number,${alias}.to_number,${alias}.context_details#>>'{recipient_data,name}',${alias}.context_details#>>'{recipient_data,area}',${alias}.city_area,${alias}.expected_rent,${alias}.built_up_area_sqft,${alias}.carpet_area_sqft,${alias}.status,${alias}.notes,${alias}.transcript)`;
export const matchesSearch=(expression:string,param:string)=>`(${expression} ilike '%'||${param}||'%' or (${param} ~ '[[:alpha:]]' and ${expression} %> ${param}))`;

// Typo tolerance belongs to names/locations, not arbitrary conversation content.
export const callIdentitySearch=(alias:string)=>`bolna_search_text(${alias}.from_number,${alias}.to_number,${alias}.context_details#>>'{recipient_data,name}',${alias}.context_details#>>'{recipient_data,area}',${alias}.city_area)`;
export const matchesCallSearch=(alias:string,param:string)=>`(${callSearch(alias)} ilike '%'||${param}||'%' or (${param} ~ '[[:alpha:]]' and ${callIdentitySearch(alias)} %> ${param}))`;

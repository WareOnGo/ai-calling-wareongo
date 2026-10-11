-- migrate: nontransactional
-- Build online: do not lock out ingestion while indexing existing transcripts.

CREATE INDEX CONCURRENTLY IF NOT EXISTS bolna_raw_search_trgm ON raw_records USING gin ((bolna_search_text(owner_name,owner_first_name,source,city,state,address,warehouse_type,source_record_id,metadata->>'email',metadata->>'pincode')) gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS bolna_call_search_trgm ON bolna_call_logs USING gin ((bolna_search_text(from_number,to_number,context_details#>>'{recipient_data,name}',context_details#>>'{recipient_data,area}',city_area,expected_rent,built_up_area_sqft,carpet_area_sqft,status,notes,transcript)) gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS bolna_phone_search_trgm ON raw_phone_numbers USING gin ((phone) gin_trgm_ops);
-- Keep exact transcript/note search; fuzzy matching uses the smaller identity index.
CREATE INDEX CONCURRENTLY IF NOT EXISTS bolna_call_identity_trgm ON bolna_call_logs
 USING gin ((bolna_search_text(from_number,to_number,context_details#>>'{recipient_data,name}',context_details#>>'{recipient_data,area}',city_area)) gin_trgm_ops);

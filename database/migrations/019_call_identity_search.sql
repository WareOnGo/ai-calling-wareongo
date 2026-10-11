-- migrate: nontransactional
-- Keep exact transcript/note search; fuzzy matching uses the smaller identity index.
CREATE INDEX CONCURRENTLY IF NOT EXISTS bolna_call_identity_trgm ON bolna_call_logs
 USING gin ((bolna_search_text(from_number,to_number,context_details#>>'{recipient_data,name}',context_details#>>'{recipient_data,area}',city_area)) gin_trgm_ops);

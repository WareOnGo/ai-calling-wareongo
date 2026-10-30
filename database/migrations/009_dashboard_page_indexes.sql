-- migrate: nontransactional
-- Match the default grid order so a page does not sort every source record.
CREATE INDEX CONCURRENTLY IF NOT EXISTS bolna_raw_page_order ON raw_records (area_sqft DESC NULLS LAST,id);
-- Fetch the assignment page before resolving contact and AI display details.
CREATE INDEX CONCURRENTLY IF NOT EXISTS bolna_assignment_page_order ON bolna_assignments (assigned_at DESC,id DESC);

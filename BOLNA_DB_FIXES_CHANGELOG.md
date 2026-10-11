# Bolna DB Fixes — changelog

**Unreleased · 11 October 2026 · based on `fd5ceb1`**  
Covers the 22 handoff requests and both subsequent code reviews. Changes are local; no production deployment or live calls were made.

[Shareable PDF with screenshots](BOLNA_DB_FIXES_CHANGELOG.pdf).

## Caller changes

- **Reliable completion:** becoming Done requires a logged call, enforced by the API and database. RNR, busy, switched off and pending callbacks remain open unless deliberately closed as **Exhausted**, with a substantive reason. There is no automatic attempt cap.
- **Legacy Done rows stay editable:** notes and results can be corrected without fabricating a call or replacing an unchanged old warehouse reference. Reopening and completing again applies current completion rules.
- **Warehouse IDs:** new/changed values must be positive integers, 1–100 digits, with no leading zero. Available completion requires an ID. Unclear completion requires a closure reason and an explanation beyond a callback promise. This validates format, not external existence.
- **Results and history:** explicit attempts, follow-up dates and corrections stay separate from AI results. Keep existing result preserves a dropdown edit. Older corrections update the assignment only when that event still supplies its result. Editing waits for the refreshed revision after call logging. Empty outcomes are labelled No manual result, since an unanswered call can already have been logged.
- **Calls edits:** notes, Added and WH ID use the assignment behind filters and reports. Safe legacy call-row onboarding is migrated to its exact assignment; unmatched/conflicting originals remain visible and exportable. Legacy Called By is labelled, read-only and hidden by default, including older saved preferences.

## Admin changes

- **Contact ownership:** manual allocation and Bolna dispatch group shared primary/alternate phones. Previews show current owners, completed contact history and AI context. Dispatch skips open human-owned contacts and rechecks live phones/owners before reservation. Queue CSV uses the same eligibility and rechecks at download.
- **Work allocation:** previews and routine saves avoid the global allocation lock. Expensive dispatch metadata loads before locking. Round-robin carries across batches and retains work already held by selected callers.
- **Assignment filters:** Unassigned excludes contacts with open or completed assignments; dropped-only qualifies. Never assigned and completed preview history also match shared contact numbers across both work channels. Source listings remain separate properties.
- **Follow-up visibility:** Assignments shows readable disposition, due date and Exhausted closure. Raw uses readable labels. Done history and reopen actions remain available.
- **AI history:** inline grid expansion shows known dials, outbound/inbound counts, time and intervals. Unqualified provider timestamps now sort and produce same-provider clock intervals, labelled **timezone not supplied**; no UTC/IST assumption. Missing identities and overwritten history remain unknown.
- **Filters and layout:** multi-select categories, sqft ranges, rent-mentioned/onboarding filters, source city, page jump, column controls and clear Needs review help. City normalization covers 13 explicit alias pairs plus trailing urban/city/district suffixes, including Bangalore Urban, Calcutta and Madras; it is not a complete location gazetteer.
- **Balance blocks and search:** balance-low is hidden from default Calls and excluded from Raw call history/status/Already called. Exact transcript/notes search remains; fuzzy Calls search is limited to identifying fields. Numeric search does not approximate neighboring phones.
- **Team and batches:** five requested measures—recorded calls, connect rate, first Available targets, onboarded references and average call duration—with evidence/CSV on demand. The default query builds only those measures. Separate manual/AI batches, exports and wallet states remain available.

## Reliability and simplification

- Webhooks and reconciliation share tolerant number/string/null optional metadata. Reconciliation commits 250 executions at a time, retains reservations after partial failure and safely replays.
- One merged per-dial table replaces the duplicate immutable delivery ledger. The latest accepted terminal webhook payload remains in the processing inbox. Unused contact-claims and wallet-cache tables and the unused Team JSON endpoint are removed. Current ownership checks use live contact mappings; the active retry policy has a SQL/TypeScript parity regression.
- Wallet uses a process-local 60-second cache, shared in-flight request and bounded timeout. Grid reads, ownership filters and search use bounded queries/indexes. Browser coverage includes saved-draft recovery, stale revisions, failed requests, mobile layouts and dark mode.
- Historical non-integer references remain visible and count where dated evidence supports them, with quality flags. A read-only counts audit found **61 assignment references across 1,700 assignments, zero non-integer references**, and **zero call-row references across 15,328 calls**. No records were changed.

## Deployment and compatibility

- Apply pending migrations **006–019 before deploying the app**, following [the runbook](docs/DEPLOYMENT.md). Migration 015 uses retryable `CREATE OR REPLACE` DDL plus resumable recovery. Each migration commits separately; 017/019 build indexes concurrently. Migration 018 preserves safe legacy onboarding and removes obsolete tables. There are **no down migrations**; backup and representative staging rehearsal are required.
- **Next.js 15 → 16.4.0**, React 19 and Webpack flags remain bundled changes. Verify Node/hosting compatibility. The old call-row write endpoint is retired; use assignment edits. The unused `/api/team/report` route is removed; evidence CSV remains.
- Existing database/session/provider settings remain. Optional wallet unit/threshold use `BOLNA_WALLET_UNIT` and `BOLNA_WALLET_LOW_THRESHOLD`.

## Validation and limits

Validation passed: TypeScript, 100 unit tests, 210 integration tests, four migration rehearsals, production build, 204 browser scenarios, 19 benchmark workloads and two separate volume-browser scenarios. The full browser run had zero failures and two intentional volume-only skips.

The [verification audit](docs/HANDOFF_COMPLETENESS_AUDIT.md) records exact complete-run results and the [performance report](docs/performance/README.md) holds the sole timing table. Tests run against disposable local databases with fake provider credentials; browser screenshots use synthetic contacts.

Production-shaped migration time, latency and live provider acceptance remain staging checks. Provider timezone is unconfirmed; local-clock intervals work without that assumption. Unlogged historical calls/durations cannot be recovered, duration is self-reported, and external warehouse existence is not checked. Imports do not automatically resolve existing ownership conflicts. Broader analytics and aggregate disagreement dashboards remain the agreed v2 scope.

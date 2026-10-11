# Bolna DB Fixes — implementation checklist

Source: **Bolna DB Fixes.docx**, 22 requests and nine screenshots.
SHA-256: `d1522a39b935839dd0b2c60a422b90b39bc3bc61d473a245dc429026202f6c74`.

Implementation is complete and awaiting deployment. This checklist describes current behavior; staging acceptance and deferred work remain explicit. See the [changelog](BOLNA_DB_FIXES_CHANGELOG.md), [test audit](docs/HANDOFF_COMPLETENESS_AUDIT.md), and [deployment runbook](docs/DEPLOYMENT.md).

## Confirmed decisions

- Unassigned excludes contacts with **open or completed** assignments. Dropped-only contacts qualify.
- Warehouse IDs are **positive integers**; zero and placeholders are rejected. No authoritative warehouse lookup was supplied.
- The Team time measure is **average call duration only**. Unlogged historical activity is unknown; duration is self-reported with coverage shown.
- Explicit **Exhausted** closure requires a logged retryable attempt and a substantive reason; no automatic cap.
- Unqualified provider times use same-provider clock intervals without assuming UTC/IST.
- The broader analytics dashboard and aggregate disagreement analysis are v2.

## Ticket checklist

| Item | Implemented behavior | Acceptance evidence / remaining limit |
| --- | --- | --- |
| H01 | [x] Manual allocation and Bolna push group shared primary/alternate phones; push skips current human ownership and rechecks at commit. | Integration queue/dispatch regressions, ownership races and browser ownership preview. No live provider call placed. |
| H02 | [x] Raw exposes manual call history, separate from AI evidence. | Manual lifecycle/history APIs and browser retry/correction coverage. |
| H03 | [x] Assign and Bolna queue previews expose caller counts, state/outcomes and AI context before confirmation. | Assignment preview, queue metadata and visible browser ownership summary. |
| H04 | [x] Categorical filters support multiple checkbox selections with matching URL/export/selection behavior. | Filter integration tests and browser multi-select regressions. |
| H05 | [x] Calls has source city; larger dashboard deferred. | Source-matching tests and city browser workflows. V2 remains unchecked below. |
| H06 | [x] Inline AI history shows known outbound/inbound attempts, timestamps and intervals where supported. | Payload replay/correction tests and inline browser timeline. Provider timezone and missing historical identities remain unresolved. |
| H07 | [x] Bounded reads, indexed ownership/search, lazy evidence and smaller page payloads. | Repeatable synthetic benchmark and throttled production-browser workflow. Production latency is not certified. |
| H08 | [x] Admin wallet balance with fresh/stale/unavailable states and process-local cache. | Provider mocks cover values, concurrency, failures and timeout; browser state tests. Live account balance not checked. |
| H09 | [x] Separate AI/manual result columns in Calls and Assignments. | Manual edits preserve AI verdict; browser headers. Aggregate disagreement dashboard deferred. |
| H10 | [x] Separate manual/AI batch browsing, cards, filters and exports. | Metrics/export reconciliation, original membership and ownership-transfer tests. |
| H11 | [x] Column controls and narrower default views; Team shows five measures. | Column preference migration, loading geometry and mobile layout tests. |
| H12 | [x] Jump-to-page controls with clamped pagination. | Grid, assignment, evidence and browser page-jump tests. |
| H13 | [x] Balance-low hidden from default Calls, retained behind explicit filters. | Reader/export consistency and browser operational visibility. |
| H14 | [x] Legacy Called By is labelled, read-only and initially hidden for saved preferences too. | Browser saved-preference migration and retired-write endpoint checks. |
| H15 | [x] Size, city aliases, rent-mentioned and onboarding filters; consistent Owner/Broker terminology. | Added/WH ID edits use the same assignment read by Calls filters; API/CSV/browser reconciliation. |
| H16 | [x] Needs review explains low-confidence AI inference and links to its filter. | Browser help text and scope/filter tests. |
| H17 | [x] Becoming Done requires a logged call; retries remain open unless explicitly Exhausted with a reason. Legacy Done edits remain allowed. | API and direct-SQL bypass rejection; legacy RNR fixture isolated; browser old Result/notes regression. |
| H18 | [x] Available requires positive integer WH ID; Unclear needs closure reason and substantive explanation. | Placeholder/decimal/negative-ID rejection, combined-field checks and browser focus/recovery. ID existence is not verified. |
| H19 | [x] Done rows expose history and reopen actions. | Ownership-checked reopen tests and browser action coverage. |
| H20 | [x] Caller workloads and persistent round-robin rotation; selected callers retain their current work. | Repeated batches, preview/commit agreement, retained ownership and idempotency tests. |
| H21 | [x] Flexible IST date range and five visible Team measures, with evidence/CSV on demand. | Boundary/correction/discovery/onboarding/duration tests. Historical unlogged calls cannot be reconstructed. |
| H22 | [x] Unassigned excludes open/completed contacts across channels and shared phones. | Grid, count, export, bulk-selection and browser regressions; dropped-only contacts included. |

## Review remediation checklist

- [x] Block Result/notes completion bypass in API and database.
- [x] Remove allocation lock from read-only preview, remark edits and attempt logging.
- [x] Limit preview invalidation to allocation/ownership changes.
- [x] Accept optional string/null provider metadata and test actual webhook storage.
- [x] Verify applied checksums; correct unreleased 015 to CREATE OR REPLACE and commit migrations separately.
- [x] Backfill AI evidence in resumable transactions; test interruption, rollback, replay and co-tenant preservation.
- [x] Build transcript/source search indexes concurrently with explicit timeout and failed-index recovery.
- [x] Correct round-robin retention and older-attempt result projection.
- [x] Consolidate Calls manual editing onto assignment validation; expose structured error fields to the UI.
- [x] Simplify Team defaults and avoid automatic evidence queries.
- [x] Replace wallet database lock/cache path with process-local cache and request deduplication.
- [x] Preserve unexpected batch-read failures instead of converting every error to 404.
- [x] Fix Raw filter badge double counting.
- [x] Check stored provider payload shapes read-only; disclose sample limits and timezone ambiguity.
- [x] Keep browser source, fixtures, configuration and lockfile inside the repository.
- [x] Ignore local maintenance SQL; shorten and correct documentation and portable links.

## Validation stages

Run DB-mutating suites sequentially against the disposable database; no test uses `.env.local` credentials. Browser requests to paid providers are mocked or use fake credentials.

1. **Rules and pure logic:** `npm run check` for TypeScript and unit tests.
2. **Database/API:** `npm run test:stage -- integration` for scope, transactions, retries, corrections, dispatch, filters, report counts and provider payload storage.
3. **Upgrades:** `npm run test:stage -- rehearsal` creates fresh, legacy, pre-handoff and interrupted-runner databases; validates all migrations, repeat execution, interrupted recovery and unrelated-table preservation.
4. **Performance:** `npm run test:stage -- performance review` rebuilds 50,000 Raw / 10,000 Calls / 5,000 assignment fixtures and measures readers, previews, search, batches and concurrent writes.
5. **Production rendering:** `npm run test:stage -- build`, then `npm run test:stage -- browser-production`. Test admin/employee flows, saving/failure recovery, dialogs, mobile/dark layouts, URL/export agreement, loading, playback controls and ownership changes.
6. **Volume browser:** after rebuilding the performance fixture, `npm run test:stage -- browser-volume-production` exercises normal and throttled responses. Final counts belong in the audit, not inferred from focused reruns.

## Before production acceptance

- [ ] Rehearse the complete pending migration sequence on representative staging data and test restore.
- [ ] Confirm Bolna's timezone for unqualified `initiated_at` values against real call history.
- [ ] Reconcile several real retry chains, live wallet units and agent configuration with an operator.
- [ ] Measure production-shaped latency, traffic contention, backfill duration and index storage.
- [ ] Perform approved user acceptance and deployment checks from the runbook.
- [ ] V2: broader analytics, funnels and aggregate property-level disagreement reporting.

Migration 018 removes unused contact claims, database wallet cache and duplicate AI delivery storage. Live contact mappings enforce ownership; one merged row retains each identified dial. Manual history remains auditable. Source imports do not automatically resolve existing ownership conflicts.

## Second review follow-up

- [x] Retry migration 015 through the real runner after an injected backfill failure.
- [x] Order provider-clock timestamps and show intervals without assuming a timezone.
- [x] Allow legacy Done-row edits; validate completion only when becoming Done.
- [x] Preserve dropdown results when logging Keep existing result and correcting older calls.
- [x] Load dispatch candidates outside the allocation lock; recheck live phones and ownership before reserving.
- [x] Share tolerant provider schemas; reconcile in bounded resumable transactions.
- [x] Export only eligible contacts from the Queue dialog.
- [x] Preserve and disclose legacy references in reports/filters; count real affected rows read-only.
- [x] Add explicit Exhausted closure with a reason, no automatic attempt cap.
- [x] Match completed history and Never assigned across shared contacts.
- [x] Exclude balance-low from Raw calling history, status and Already called.
- [x] Display disposition/due date in Assignments and readable disposition labels throughout.
- [x] Expand documented city aliases and normalize city/district suffixes.
- [x] Migrate attributable legacy call-row onboarding; retain/export unmatched original values.
- [x] Restrict fuzzy search to identifying fields; keep exact transcript/note search.
- [x] Remove dead claims/cache/delivery-ledger tables and redundant Team report work.
- [x] Centralize active retry policy and test database/application agreement.
- [x] Run all relevant checks, inspect screenshots, and produce a shareable PDF changelog.

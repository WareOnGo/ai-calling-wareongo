# Deployment runbook

The core release is deployed. Production migrations 006–008 were applied on 12 October 2026 after explicit authorization; the latest calling-form usability changes remain local and need an app deployment only. Applied migration files must not be edited.

## Production catch-up — 12 October 2026

- Verified that the production deployment matched commit `8fb7597` and that the database ledger/checksums matched baseline through 005 before starting.
- Saved a private, application-table PostgreSQL archive (35,089,808 bytes) and verified its archive listing. A restore was not rehearsed.
- Applied 006 schema, 007 retained-history recovery and 008 online search indexes successfully. Recovery processed 15,329 retained call rows and 15,329 webhook rows; overlapping deliveries merge into 7,281 identifiable dials.
- A pinned read-only transaction verified the final migration checksums, all four valid indexes, and actual application readers for Assignments, My Work, Raw, Calls, Batches and Team. No customer row contents were printed.
- This was a live schema catch-up after the app deployment. The read-only checks establish that those queries succeed; they are not an authenticated production-browser or live-calling acceptance test.

The initial verification helper's connection option did not enforce read-only mode through the pooler. It stopped before page queries; verification was then completed inside an explicitly pinned `BEGIN READ ONLY` transaction.

The general rollout procedure below remains the guide for future deployments. Local synthetic checks do not certify production migration or restore performance.

## Before rollout

1. Review the Next.js 16.4.0 major upgrade, lockfile, required Node runtime and hosting adapter. Run the tracked checks and production browser harness.
2. Supply the intended DDL-capable direct connection explicitly, using verified TLS and `DATABASE_SSL_CA` when needed. The runner does not load `.env.local`. Never print connection credentials.
3. Check existing migration names/checksums. Baseline and 001–005 are unchanged. The retired, unshipped 006–019 sequence was consolidated into 006–008. A database with retired names is refused: rebuild disposable development data or prepare a reviewed forward upgrade. Do not delete ledger entries or bypass checksum mismatches.
4. Rehearse schema, recovery and indexes on staging, measuring duration, locks and disk space. Ordinary statements retain 30-second statement and two-second lock limits. Concurrent indexes have no lock timeout, with a ten-minute statement limit configurable through `MIGRATION_INDEX_TIMEOUT_MS` (1000–3600000).
5. After staging schema migration, run `database/handoff-audit.sql` read-only; it depends on the new handoff views/functions. Review conflicting owners, invalid completions and reused references. The counts-only `database/audit-provider-shapes.mjs --legacy-only` can assess retained references separately. Do not run local maintenance SQL as part of deployment.

## Apply and deploy

1. Pause dispatch, manual writes, ingestion and worker schedules. Drain old requests and retain incoming webhook events for retry/replay.
2. With `DIRECT_URL` (or `DATABASE_URL`) and TLS configuration supplied in the operator environment, run `npm run db:migrate`. Use `--init` only for an empty app schema.
3. Stage **006** installs only the final schema, policies and safe legacy-onboarding preservation. Stage **007** commits retained-payload recovery in 250-row pages with its cursor. Stage **008** builds indexes concurrently outside a transaction. Each completed stage is recorded separately.
4. If a stage fails, earlier commits remain. Remove the cause and rerun the same command. Recovery resumes its cursor without replaying schema DDL. The runner removes invalid partial indexes before retrying an online build.
5. Deploy the app with the existing session, database, webhook, worker and agent settings. Keep provider keys server-side; confirm wallet units/threshold if configured. Resume ingestion and schedules.
6. For retained-payload catch-up after older app traffic, use `node database/backfill-ai-evidence.mjs --restart`. A normal invocation resumes its cursor; `--restart` idempotently rescans the retained sources. Neither can recover overwritten identities.
7. Check sign-in/scope, shared-contact ownership filters, assignment/CSV eligibility, no-call/RNR completion rejection, Done edits, integer WH IDs, Unclear reasons and deliberate Exhausted closure. Verify both batch pages, final-status cards, UTC-to-IST display, readable intervals, Team evidence and wallet errors. Confirm the provider's timezone convention against a known call.
8. Monitor webhook errors, backlogs, reconciliation offsets/expired leases, database waits and latency. Reconciliation resumes unchanged snapshots, restarts changed snapshots safely, and yields after 1,000 upserts. Calling reservations remain after partial progress. Verify uncertain provider dispatches before releasing or resending them.

Only place a live test call with an explicitly approved test number. No live call or production write was made in this delivery.

## Recovery

There are no down migrations. Partial upgrades resume forward. An app-only rollback can restore writes incompatible with the new policy; assess compatibility first. For full rollback, restore the verified backup into the recovery environment and account for all webhooks/calls accepted since that backup before resuming traffic.

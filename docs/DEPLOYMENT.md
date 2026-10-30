# Deployment runbook

For the selective main merge, migrations through 018 (including 009) are deployed on the shared database. Migration 018 was applied on 30 October 2026 at 22:54 IST; all checksums matched and a second migration run was a no-op. Preserve the current shared trigger settings. See the [018 rollout record](../database/reviews/018-employee-workflow-2026-10-30.json) and [employee compatibility](EMPLOYEE_WORK_COMPATIBILITY.md).

For a fresh environment: Local synthetic checks do not certify production migration volume. Verify a restorable backup and rehearse the entire pending sequence on representative staging data.

## Before rollout

1. Review the Next.js 16.4.3 upgrade, lockfile, required Node runtime and hosting adapter. Run the tracked checks and production browser harness.
2. Supply the intended DDL-capable direct connection explicitly, using verified TLS and `DATABASE_SSL_CA` when needed. The runner does not load `.env.local`. Never print connection credentials.
3. Check existing migration names/checksums. Baseline and 001–005 are unchanged. The retired, unshipped 006–019 sequence was consolidated into 006–008. A database with retired names is refused: rebuild disposable development data or prepare a reviewed forward upgrade. Do not delete ledger entries or bypass checksum mismatches.
4. Rehearse schema, recovery and indexes on staging, measuring duration, locks and disk space. Ordinary statements retain 30-second statement and two-second lock limits. Concurrent indexes have no lock timeout, with a ten-minute statement limit configurable through `MIGRATION_INDEX_TIMEOUT_MS` (1000–3600000).
5. After staging schema migration, run `database/handoff-audit.sql` read-only; it depends on the new handoff views/functions. Review conflicting owners, invalid completions and reused references. The counts-only `database/audit-provider-shapes.mjs --legacy-only` can assess retained references separately. Do not run local maintenance SQL as part of deployment.

## Apply and deploy

1. Pause dispatch, manual writes, ingestion and worker schedules. Drain old requests and retain incoming webhook events for retry/replay.
2. With `DIRECT_URL` (or `DATABASE_URL`) and TLS configuration supplied in the operator environment, run `npm run db:migrate`. Use `--init` only for an empty app schema.
3. Stage **006** installs only the final schema, policies and safe legacy-onboarding preservation. Stage **007** commits retained-payload recovery in 250-row pages with its cursor. Stage **008** builds search indexes and **009** adds Raw/Assignment pagination indexes, concurrently outside a transaction. Each completed stage is recorded separately. The [loading audit](performance/LOADING_AUDIT.md) records 009's local validation; applying it to a shared database remains a deployment step.
4. If a stage fails, earlier commits remain. Remove the cause and rerun the same command. Recovery resumes its cursor without replaying schema DDL. The runner removes invalid partial indexes before retrying an online build.
5. Deploy the app with the existing session, database, webhook, worker and agent settings. Keep provider keys server-side; confirm wallet units/threshold if configured. Resume ingestion and schedules.
6. For retained-payload catch-up after older app traffic, use `node database/backfill-ai-evidence.mjs --restart`. A normal invocation resumes its cursor; `--restart` idempotently rescans the retained sources. Neither can recover overwritten identities.
7. Check sign-in/scope, shared-contact ownership filters, assignment/CSV eligibility, the original employee Done/reopen and free-text WH-ID workflow, plus completion validation through the separate manual-call API. Verify both batch pages, final-status cards, UTC-to-IST display, readable intervals, Team evidence and wallet errors. Confirm the provider's timezone convention against a known call.
8. Monitor webhook errors, backlogs, reconciliation offsets/expired leases, database waits and latency. Reconciliation resumes unchanged snapshots, restarts changed snapshots safely, and yields after 1,000 upserts. Calling reservations remain after partial progress. Verify uncertain provider dispatches before releasing or resending them.

Only place a live test call with an explicitly approved test number. Synthetic validation and the recorded production smoke checks do not place calls or change production tasks. Applied schema changes are recorded under `database/reviews`.

## Recovery

There are no down migrations. Partial upgrades resume forward. An app-only rollback can restore writes incompatible with the new policy; assess compatibility first. For full rollback, restore the verified backup into the recovery environment and account for all webhooks/calls accepted since that backup before resuming traffic.

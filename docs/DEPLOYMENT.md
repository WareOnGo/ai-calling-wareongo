# Deployment runbook

This release is not deployed. Use a database backup with a tested restore procedure and a representative staging copy before production. Local synthetic benchmarks are not a production-volume migration rehearsal.

## Before rollout

1. Inspect the diff and dependency lockfile, including the Next.js 16 major upgrade. Use the supported Node runtime (`next` requires Node >=20.9; local validation uses Node 22) and verify the hosting adapter. Run the tracked checks and browser harness.
2. Supply a DDL-capable direct database connection explicitly, with verified TLS and `DATABASE_SSL_CA` when needed. Migration commands do not load `.env.local` automatically. Confirm the target without printing credentials.
3. Review existing `bolna_schema_migrations` names/checksums and run `database/handoff-audit.sql` read-only. Resolve ownership conflicts and assess legacy invalid completions. Migration 015 is unreleased and its two merge functions were corrected to `CREATE OR REPLACE`; do not bypass a checksum mismatch on an installation that applied different bytes. The counts-only `database/audit-provider-shapes.mjs --legacy-only` uses a read-only transaction. Do not rewrite history or run `database/maintenance/` as part of deployment.
4. Rehearse the entire pending sequence on staging at representative volume. Measure lock waits, backfill time, index size and free disk space. Migrations 008/009 take assignment-table DDL locks; these now end at each migration commit. Thirty-second ordinary statement and two-second lock limits still apply. Index builds allow ten minutes, adjustable with `MIGRATION_INDEX_TIMEOUT_MS`.

## Apply and deploy

1. Pause dispatch, manual writes, ingestion and worker schedules; drain old requests. Ensure provider webhook delivery can retry or is safely queued for replay during maintenance. Do not discard incoming events.
2. With `DIRECT_URL` (or `DATABASE_URL`) and TLS configuration already set in the operator environment, run:

   ```bash
   npm run db:migrate
   ```

   Use `--init` only for an empty app schema. Each migration commits independently. Migration 015 runs idempotent DDL, then historical recovery in 250-row transactions with dial evidence and cursor committed together. Migrations 017/019 build indexes concurrently, without wrapping them in a transaction. Migration 018 copies safe exact-call legacy onboarding, preserves historical references, and removes the unused claims/cache/delivery-ledger tables. Take the backup before this destructive schema cleanup.
3. A failure leaves earlier commits intact. Read the error, remove contention or correct the environment, then rerun the same command. Never delete ledger rows or manually mark a failed migration as applied. A failed concurrent index build is removed and retried by the runner.
4. Deploy the app with the existing session, database, webhook, worker and agent settings. Keep provider keys server-side. Confirm wallet units/threshold if configured.
5. Resume ingestion and schedules. For catch-up, especially if an older app accepted events while recovery ran, execute the idempotent scan:

   ```bash
   node database/backfill-ai-evidence.mjs --restart
   ```

   A normal invocation resumes its last committed cursor; `--restart` rescans retained sources without duplicating evidence. This recovers retained identities only, not overwritten provider history.
6. Verify sign-in and caller scope, contact-wide Unassigned/Never assigned exclusions, no-call/RNR completion rejection, explicit Exhausted closure with reason, legacy Done edits, integer WH ID + Added filtering, CSV ownership exclusion, local-clock dial intervals, both batch pages, Team coverage and wallet error handling. Batch reconciliation now commits 250 executions at a time and retains reservations after partial failure. Only perform a live calling test with an explicitly approved test number and operator confirmation.
7. Monitor webhook 4xx/5xx, processing backlog, database waits and page latency. Inspect uncertain dispatches instead of blindly resending them.

## Recovery

There are no down migrations. A partially applied upgrade can resume forward. Reverting the application alone may restore old write paths incompatible with the stricter completion policy; assess compatibility first. For a full rollback, restore the verified backup into the chosen recovery environment and account for all accepted webhooks/calls since that backup before resuming traffic.

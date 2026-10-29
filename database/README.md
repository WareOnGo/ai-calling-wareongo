# Database migrations

## Warehouse phone backfill (014)

`014_warehouse_contacts.sql` adds phone-to-warehouse associations and guards new
caller assignments, reopening and AI batch items. Matching covers **all raw
listings**, including unassigned records and alternate phones, plus AI execution
numbers and retained-phone fallbacks. Existing tasks remain editable; importing
the snapshot does not close work or change availability, caller notes or owners.

After applying 014, run the one-time data migration with explicit caller and WAG
connections. It only reads WAG's `Warehouse` table; the dashboard needs no WAG
credentials at runtime. Use verified TLS and `DATABASE_SSL_CA` as above.

```bash
# Set DIRECT_URL (caller) and WAREHOUSE_DATABASE_URL (WAG) in the environment.
node database/backfill-warehouse-contacts.mjs          # full transaction, rolled back
node database/backfill-warehouse-contacts.mjs --apply  # commit the one-time import
```

The import strips phone formatting/country prefixes, matches the final ten
digits and splits comma/slash/semicolon/pipe/newline-separated numbers. Every
warehouse ID is retained in `bolna_warehouse_contacts`; `bolna_warehouse_matches`
relates those numbers to raw records and calls. The import fills an empty legacy
WHID only for a single unambiguous warehouse and marks matched assignments/calls
as added to DB. Nonempty IDs are preserved. Invalid legacy completion records
retain their scalar WHID until repaired; all matched IDs still appear in the UI.
Each changed assignment is audited and its revision increments. The source
snapshot time, checksum and counts are stored in `bolna_warehouse_imports`;
repeating the data migration is a no-op. No rolling refresh or scheduler is added.

This migration is required before deploying the updated application. On a shared
installation with unrelated pending migrations, review its ledger and apply only
014 in a transaction with its checksum recorded, without replaying older files.

Applied and verified on 30 October 2026 IST. The snapshot matched 988 raw phone
numbers across 2,493 raw listings and 362 assignments. It filled 145 blank
assignment WHIDs and 424 blank call WHIDs; existing IDs, notes, outcomes, owners,
states and dates were preserved. Both new guards are enabled, and existing
trigger settings and pending migration 009 were preserved. See the
[backfill report](../docs/warehouse-backfill-2026-10-30.json) for counts and checksums.

The adversarial review found that an in-place caller change could bypass 014
while the shared installation's general ownership trigger is disabled.
`015_warehouse_reassignment_guard.sql` adds `assignee` to the guard's trigger and
change detection. It was rehearsed with rollback, applied, and independently
verified on 30 October 2026 IST. All assignment data, audit records, imported
associations, existing trigger settings and pending migration 009 were preserved.
Migration 014's applied checksum remains unchanged.

The UI exposes the phone association through **Warehouse DB match** and all
matched WHIDs. **Added to DB** and **Onboarded** retain their saved verification
semantics. Raw, call and batch CSVs include separate match and matched-ID columns.
See the [review report](../docs/warehouse-review-2026-10-30.json).

`baseline.sql` contains only Bolna Processing's tables, indexes, constraints,
generated phone column and analysis view. Source datasets, credentials and other
applications' tables are excluded. `migrations/` is the authoritative forward
history. Runtime code uses `pg`; private Prisma introspection is optional tooling.

Use a DDL-capable connection, preferably `DIRECT_URL`. The runner accepts
`DATABASE_URL` as a fallback and deliberately does not load environment files.
It defaults to verified TLS, accepts `DATABASE_SSL_CA` for a private CA, and
supports `DATABASE_SSL=disable` for an isolated local database.

```bash
# Fresh database with no existing app tables
node --env-file=.env.local database/migrate.mjs --init

# Existing installation; applies only missing forward migrations
node --env-file=.env.local database/migrate.mjs
```

`--init` refuses to run when app tables exist. Normal migration adopts the
existing baseline only when all nine original tables and the analysis view
exist; it never replays the baseline against them. Adoption checks presence,
not complete schema equivalence: compare an installation with private/custom
schema changes before adopting it. Missing columns or incompatible constraints
fail the transaction rather than being silently skipped.

The runner holds a session advisory lock and commits each migration separately.
Applied file checksums are verified. Baseline and migrations 001–005 are unchanged.
The unshipped 006–019 development sequence is consolidated into 006 schema,
007 retained-payload recovery and 008 concurrent indexes. No superseded intermediate
tables or policies are created. An installation carrying retired migration names
is refused; rebuild a disposable development database or prepare a specific
forward upgrade. Never bypass the ledger or edit applied production migrations.

Stage 007 uses 250-row transactions and commits evidence with its cursor. Its
checksum is recorded only after recovery finishes. An interruption resumes that
cursor; the already-recorded schema stage is not rerun.

Stage 008 builds indexes concurrently. Its lock timeout is zero so older
transactions can finish, while the overall statement timeout defaults to ten
minutes (`MIGRATION_INDEX_TIMEOUT_MS`, 1000–3600000). Invalid partial indexes are
removed before retrying. Ordinary statements retain thirty-second statement and
two-second lock limits. A failure rolls back only the active transaction;
earlier stages remain applied. Fix the cause and rerun. No down migrations exist.

See the [deployment runbook](../docs/DEPLOYMENT.md) for maintenance, recovery,
backfill catch-up and production-volume rehearsal requirements.

Do not use private `db:push` or old post-push SQL after adopting this history;
they do not know about the new job, revision, reservation and retry columns.

## Rollout

1. Back up the intended database and test its schema against these migrations.
2. Pause process/enrich/district scheduler jobs and dispatch traffic; allow old
   in-flight requests to finish. Old workers do not honor the new lease tokens.
3. Apply migrations with a DDL-capable connection.
4. Configure a dedicated `SESSION_SECRET` and verified database TLS, then deploy
   the app. Existing legacy session cookies require a new sign-in.
5. Enable `/api/process`, `/api/enrich`, optional `/api/district`, and
   `/api/batches/reconcile` schedules. Processing no longer performs inline
   inference, so the enrichment schedule is required for automatic analysis.
6. Review legacy failed batches in Recent batches. Migration conservatively
   reserves their numbers because old failures could hide a successful send.

The app does not migrate at startup. These files do not configure production
cron, Vault, secrets, backups or deployments. See the application README for
endpoint authorization and worker operation.

### Hindi and English batches

Apply `003_multi_agent_and_carpet_area.sql` through the migration runner before
deploying the multi-agent application. It adds parent dispatch requests, agent
language on child batches, and a separate carpet-area column to calls and the
analysis view. Existing batches and built-up values remain intact.

Keep the existing `BOLNA_AGENT_ID` for Hindi and set `BOLNA_ENGLISH_AGENT_ID` to the
English agent's ID in the app's deployment environment. Both agents use the same
authenticated webhook. Automatic routing sends Tamil Nadu, Kerala and Karnataka
to English, with other/unknown states using Hindi. Verify the per-agent preview
before confirming the first live batch. The migration does not alter any agent's
speech settings or launch calls.

Migration `004_private_operational_tables.sql` enables RLS on the operational
tables and removes direct `anon`/`authenticated` access to them and the analysis
view. The dashboard reads these through its authorized server connection, not
the Supabase browser API. Keep that connection on the configured database owner
or explicitly provision a suitable server role.

Migration `005_legacy_district_column.sql` adds `inferred_district` to older
installations that did not receive the optional baseline addition. It is needed
by processing and enrichment even when district inference is not scheduled.

Before adopting a legacy installation, rehearse the **entire pending sequence**
against its schema and run integration tests there. Passing tests on a fresh
baseline alone does not prove compatibility with an existing installation.
For the migration CLI, set `DATABASE_SSL_CA` to Supabase's downloaded certificate.
The application bundles Supabase's public root CA for Supabase database hosts;
`DATABASE_SSL_CA` overrides it when an operator supplies a custom trust anchor.
Certificate and hostname verification remain enabled by default.

## Recovery

Event leases expire after 90 seconds; inference/district leases after 120 seconds.
Workers reclaim them and fence older workers automatically. Attempts count claims,
including interrupted runs. Exhausted events and jobs remain inspectable in
`bolna_webhook_events` and `bolna_call_jobs`; `/api/health` reports their counts.
After correcting the cause, an operator may reset a specific exhausted row's
attempts and due time, provided its lease is expired. Never reset active leases.
Per-call admin inference accepts `{ "force": true }` to retry a current-version
result or exhausted job while retaining connection/cost/transcript gates.

Dispatch has no automatic create/schedule retry. Unknown provider outcomes remain
reserved. Recent batches can check the provider or record an administrator's
verified completion/cancellation. This records who released the reservation and
why; it does not itself cancel remote calls.

## Background batch polling

After migration `011_batch_polling.sql` and the updated backend are deployed,
install the production scheduler explicitly. The scheduler is separate from schema
migrations because a local or preview database must not install a production job.
Both dashboard branches share the production database, so only one schedule is needed.

```bash
# Rehearse configuration; all DDL and cron changes roll back.
node --env-file=.env.local database/schedule-batch-polling.mjs
# Install or update only the named reconcile-batches job.
node --env-file=.env.local database/schedule-batch-polling.mjs --apply
```

The installer verifies that the existing Vault `process_secret` equals the supplied
`PROCESS_SECRET`. It reuses that secret without printing or changing it. The
private `call_batch_reconcile_endpoint()` function posts to the production
`/api/batches/reconcile` endpoint every five minutes, with a 280-second HTTP timeout
for the 300-second worker. Other scheduler jobs and their timeouts are untouched.
The application performs provider GET requests only; polling cannot schedule,
retry, stop or cancel calls. It imports missed snapshots in bounded pages and only
releases reservations after every target and current final snapshot is verified.
Balance-blocked and pending executions remain visible without inventing calls.

Verify **HTTP delivery as well as cron execution**: a successful cron invocation
only queues a request. Check `cron.job_run_details`, the corresponding
`net._http_response` entry, and the batch's `reconciliation_checked_at`,
`reconciliation_provider_state`, `reconciliation_counts` and cursor fields. A
successful endpoint response reports `checked` and `succeeded`; investigate any
failed checks using `call_batches.last_error`. Keep request headers and Vault values
out of logs. To pause only this scheduler, use
`select cron.unschedule('reconcile-batches');`. This leaves saved results intact.

References: [Supabase Cron](https://supabase.com/docs/guides/cron/quickstart),
[pg_net HTTP timeouts and responses](https://supabase.com/docs/guides/database/extensions/pg_net),
and [Bolna batch states](https://www.bolna.ai/docs/api-reference/batches/get_batch).


## Bolna DB Fixes rollout (006–008)

The schema stage adds shared contact ownership, durable manual batches, manual
attempt/audit history, canonical completion rules, numeric/search helpers,
per-dial AI history and the reconciliation cursor/lease. It preserves safe exact-call
legacy onboarding without manufacturing dates. Obsolete contact claims, wallet
cache and duplicate delivery-ledger tables are absent from the consolidated schema.

Done inserts/transitions need a logged call. Already-Done edits skip that one
requirement but still validate result, WH ID, notes and closure whenever relevant
values change. Available always needs a positive integer WH ID, including Exhausted
closures. Retry work can be deliberately closed as Exhausted with a substantive
reason; there is no additional attempt threshold or automatic cap. Invalid legacy
completions can be repaired atomically or reopened.

Provider timestamps without an offset are interpreted as UTC, independently of
session TimeZone. Explicit offsets retain their instant. The app stores UTC and
displays IST. Confirm the provider convention against a known call before rollout.

Run [handoff-audit.sql](handoff-audit.sql) after schema migration on staging (it uses
handoff views/functions). It identifies overlapping ownership, invalid Done rows,
missing phones, reused references and legacy ungrouped assignments. Row samples
are capped at 200. Source imports do not automatically resolve ownership conflicts.

The local rehearsals cover fresh, legacy, through-005, interrupted recovery and
concurrent-index timeout/retry. They check co-tenant preservation, legacy onboarding,
unknown dates, retired-history rejection and an index wait exceeding two seconds.
They do not replace a representative staging migration and restore rehearsal.

## V2 manual-call tags

`012_manual_call_tags.sql` adds Owner unresponsive, Leased out and No property for rent to the assignment and manual-event constraints. Owner unresponsive joins the retryable dispositions used by follow-up and completion checks. Existing events, audit history and trigger enablement are preserved. Apply this forward migration before deploying the V2 tag controls; no new credentials are needed.

Migration 012 was applied to the shared production database on 21 October 2026 with explicit approval. The transaction verified unchanged fingerprints for all 2,379 assignments, 2 manual attempts and 3,084 assignment-audit records, and preserved every trigger's enabled/disabled state. The migration ledger and validated constraints were rechecked after commit. Migration 009 remains pending and was not included.

Both app URLs now use the expanded database vocabulary. The V2 UI and the explicit ownership check for reopening a single assignment are implemented on the feature branch and take effect when that code is deployed. The reopening check must run in the application because the shared database still has `bolna_assignment_contacts_sync` and `bolna_assignment_quality_guard` disabled for compatibility with the older dashboard.

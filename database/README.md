# Database migrations

## Warehouse phone backfill (014)

`014_warehouse_contacts.sql` adds phone-to-warehouse associations and guards new
caller assignments, reopening and AI batch items. Matching covers **all raw
listings**, including unassigned records and alternate phones, plus AI execution
numbers and retained-phone fallbacks. Existing tasks remain editable; importing
the snapshot does not close work or change availability, caller notes or owners.

After applying 014, run the one-time data migration with explicit caller and WAG
connections. It only reads WAG's `Warehouse` table; this one-time operation needs no WAG
credentials at runtime. The periodic worker described below uses a separate read-only role.
Use verified TLS and `DATABASE_SSL_CA` as above.

```bash
# Set DIRECT_URL (caller) and WAREHOUSE_DATABASE_URL (WAG) in the environment.
node database/backfill-warehouse-contacts.mjs          # full transaction, rolled back
node database/backfill-warehouse-contacts.mjs --apply  # commit the one-time import
```

The import accepts ten-digit numbers and the recognized Indian prefixes `+91`,
`91`, `0` and `0091`, allowing spaces, parentheses, dots, dashes and Unicode
formatting. It splits comma/slash/semicolon/pipe/newline-separated numbers.
Malformed lengths, foreign prefixes, extensions and arbitrary leading digits
are rejected instead of being truncated into a different ten-digit number. All
warehouse IDs for each accepted number are retained in `bolna_warehouse_contacts`; `bolna_warehouse_matches`
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

### Correct legacy phone parsing

The original parser could truncate malformed or foreign phone strings into
Indian contact keys. The correction uses a fresh read-only WAG snapshot to find
pairs supported only by that old parsing. It preserves any pair also supported
by a valid primary or alternate number, including multiple WHIDs for one number.

```bash
# Same explicit connections as the original backfill. Default is rollback.
node database/backfill-warehouse-contacts.mjs --repair-phone-parsing
node database/backfill-warehouse-contacts.mjs --repair-phone-parsing --apply
```

This repairs only existing associations from `wag-warehouse-contacts-v1`; it does
not import new warehouses or perform a rolling refresh. Exact removed rows and
their source tokens are archived transactionally in the private import ledger
under `wag-warehouse-contact-parsing-v2`. Repeating it is a no-op. No applied SQL
migration or original import record is changed. If a rejected number already
appears in raw contacts, call contacts or batch items, the repair refuses to
proceed automatically so dependent saved fields can be reviewed first.

Applied and independently verified on 30 October 2026 IST after rollback
rehearsal. Twelve unused malformed associations were archived and removed,
leaving 3,142 valid associations. All 988 matched raw numbers, 2,493 matched raw
listings, 536 matched calls and 362 matched assignments were preserved, along
with saved notes, flags and WHIDs. See the
[parsing correction report](../docs/warehouse-parsing-repair-2026-10-30.json).

## Periodic warehouse sync (016–017)

`016_warehouse_sync.sql` creates private sync state, run history and a review queue.
It starts **disabled**. It does not install a cron job, change the original import,
or modify previously applied migrations. `017_warehouse_sync_cursors.sql` adds
warehouse, audit and rotating-review cursors. Apply only these two migrations on
the shared production database; unrelated pending migration 009 must remain pending.

The existing `enrich-analysis` cron keeps its identity and ten-minute schedule.
Its wrapper independently queues the existing enrichment endpoint and, when due,
`POST /api/warehouses/sync`. Successful runs advance the previous scheduled slot
by the configured interval, skipping missed slots after downtime. This keeps
the default cadence hourly instead of drifting to 70 minutes by adding an hour
to completion time. The first due slot is picked up by the next ten-minute tick.
They run even with no enrichment work or `ENABLE_ENRICHMENT=false`.
No source database read occurs when an assignment dialog opens or submits.

The first successful run establishes a consistent baseline of WAG's `Warehouse.id`,
`contactNumber` and `alt_phone_number`, saving the highest warehouse ID and the
latest relevant audit position. Later runs fetch up to 500 newer warehouses and
500 newer relevant audit events. The audit cursor is `(createdAt, id)`, preserving
PostgreSQL's exact timestamp text and precision so equal timestamps and local
JavaScript timezones cannot skip events. A backlog is due again at the next
ten-minute cron tick. Cursor advancement commits atomically with the imported data.

Apply `warehouse-source-audit-view.sql` **to WAG**, not the caller database. Its
private view exposes only the audit event ID, timestamp and affected integer WHID.
It includes warehouse create/delete events, phone-field updates, legacy updates
without a reliable field list, and staging approvals. Phone values in WAG's audit
log are masked, so the worker rereads current phone fields from `Warehouse`.
It does not copy audit actors, full metadata or masked values into the caller DB.

WAG writes audits asynchronously after responding and may lose failed audit
writes. Each run replays up to 500 events within the preceding 24 hours of its
audit cursor, without moving the cursor backward. It also rotates through 250
older source/previously matched WHIDs to catch direct DB edits, late ID commits,
and failed audits. This visits roughly 3,250 IDs in 13 successful hourly runs;
ordinary audited changes and new IDs are still caught by the main cursors.
The review page includes known IDs missing from WAG, so deletions remain reviewable.
There is no periodic full-table snapshot after bootstrap. An overlap that exceeds
the event cap is reported as `auditReplayLimited`; the rotating pass remains the
fallback for older missed events. Counters and hashes describe each run's batch,
and `mode` distinguishes bootstrap from incremental runs.

The worker uses `WAREHOUSE_DATABASE_URL`. Provision a
dedicated login with SELECT on only those columns, schema USAGE, database CONNECT,
and a SELECT RLS policy for that role, plus SELECT on the restricted audit view.
Give it no direct audit-table access, role memberships or write grants.
Set its default transactions read-only; the worker also explicitly opens a
read-only transaction. Keep this credential server-side in deployment secrets.
It always verifies TLS; a separate `WAREHOUSE_DATABASE_SSL_CA` is optional.

Matching reuses the corrected parser above and covers the full raw dataset,
including unassigned records, open/closed assignments, and calls. Every matching
integer WHID is retained. Only blank saved WHIDs with a single unambiguous,
currently supported match are filled, subject to existing completion rules.
Existing WHIDs, caller notes, availability, ownership, completion status and
`added_to_db` are preserved. Unlike the one-time backfill, this worker **never
automatically sets the caller's Added flag**. Changed assignment revisions and
their before/after audit events identify `warehouse-contact-sync` as the actor.
The fill step runs even with an empty or unchanged incremental batch, covering
new call rows using the existing associations.

Pairs absent from a warehouse's refreshed phone fields stay in the association table and
continue to exclude allocations. They enter `bolna_warehouse_sync_reviews` with
reason `missing_from_source`; no new saved WHID is filled from unresolved evidence.
A partial batch reviews only its fetched WHIDs, never unrelated associations.
An empty result is valid for deleted warehouses or no new work. A returning pair
resolves its review. An operator must explicitly review any
removal/correction; this worker never deletes associations or rewrites saved IDs.

The caller DB grants a 180-second lease before the WAG read. The worker has a
120-second request limit. A second invocation skips while leased, and stale
workers cannot commit after lease expiry or replacement. Applying associations,
reviews, WHIDs and success metadata is one transaction under the existing
allocation lock. Source and apply failures preserve the last successful mapping,
record a sanitized error code and retry on a later cron tick (five-minute retry
delay). Crashes are recovered after lease expiry. Empty baseline or invalid
snapshots fail without altering associations or advancing cursors.

Rollout order:

1. Rehearse 016/017 and both bootstrap and incremental apply inside a transaction, then roll back and
   verify the original migration ledger, saved values, associations and triggers.
2. Apply 016/017, configure the source role and restricted audit view, and deploy the worker.
3. Verify unauthorized requests fail and the authenticated status endpoint works.
   Rehearse source access with the read-only role before enabling the worker.
4. Use the scheduler installer with explicit caller DB and `PROCESS_SECRET`:

```bash
node database/schedule-warehouse-sync.mjs                  # validates worker; rolls back
node database/schedule-warehouse-sync.mjs --apply --enable # attaches existing cron and enables
```

The installer verifies the Vault `process_secret`, refuses an unexpected existing
cron command and preserves its schedule/active state. It leaves the original
`call_enrich_endpoint()` definition intact. Each enqueue has its own exception
handler; failure in either cannot undo the other's queued HTTP request. The
warehouse HTTP timeout is 110 seconds. Credentials belong in Authorization
headers, never query strings or logs.

Authenticated `GET /api/warehouses/sync` reports last success, next attempt,
lease expiry, saved cursors, sanitized errors, ten recent runs and the pending review count.
GET never starts a sync. Inspect both `cron.job_run_details` **and** pg_net's
`net._http_response`/worker run history: cron success alone only proves enqueueing.
Inspect missing pairs through the private review table; do not export phone
numbers or secrets in routine operational reports.

To pause warehouse syncing while retaining enrichment and existing associations:

```sql
UPDATE public.bolna_warehouse_sync_state SET enabled=false WHERE id=1;
```

To detach the wrapper, use `cron.alter_job` on `enrich-analysis` to restore its
original command `select public.call_enrich_endpoint();`. Keep the tables and
history; do not roll back already filled WHIDs or disable allocation guards.
The interval can be changed with `interval_seconds` (600–86400); set
`next_attempt_at=clock_timestamp()` to make the next tick due immediately.

Enabled and verified on 30 October 2026 IST. Bootstrap reached WHID 3227 across
3,054 warehouses, added two associations (3,142 → 3,144), and filled three blank
call WHIDs. The subsequent live incremental request read 265 warehouses,
replayed 15 audit events, and made no further data changes. Both pg_net requests
returned HTTP 200, and the existing enrichment cron succeeded with its wrapper
at 08:30 UTC. No protected-field changes occurred on sync-filled rows; unrelated
caller status edits and enrichment notes continued during verification. The
original enrichment function, other cron jobs, trigger configuration and pending
migration 009 were preserved. See the [rollout report](../docs/warehouse-sync-rollout-2026-10-30.json).

The production review later confirmed the automatic 15:00 IST run advanced from
WHID 3227 to 3229 and imported three additional associations. An independent
read-only source comparison found all 3,147 expected pairs present, with no extra
or missing pairs. The review corrected completion-time schedule drift: the
patched worker was exercised through pg_net, returned HTTP 200, and saved the
exact next hourly slot (16:00 IST). All 409 integration tests passed, including
new cadence and missed-slot regressions. See the [production review](../docs/warehouse-sync-review-2026-10-30.json).

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

Migration 012 was applied to the shared production database on 21 October 2026 with explicit approval. The transaction verified unchanged fingerprints for all 2,379 assignments, 2 manual attempts and 3,084 assignment-audit records, and preserved every trigger's enabled/disabled state. The migration ledger and validated constraints were rechecked after commit. Migration 009 was pending at that time and was subsequently deployed on 30 October 2026; see the rollout record below.

Both app URLs now use the expanded database vocabulary. The V2 UI and the explicit ownership check for reopening a single assignment are implemented on the feature branch and take effect when that code is deployed. The reopening check must run in the application because the shared database still has `bolna_assignment_contacts_sync` and `bolna_assignment_quality_guard` disabled for compatibility with the older dashboard.

## Selective main merge and employee compatibility

The overhaul/Callyzer/admin feature set is combined with the original employee
My Work screen. See [employee workflow compatibility](../docs/EMPLOYEE_WORK_COMPATIBILITY.md)
for the component/API boundaries and the retained editing behavior.

Migration 009 was deployed on 30 October 2026 at 16:30 IST. Baseline and 001–017
matched `707f7971fa6982b73e502d3ef8cc3ee778b54848`; both pagination indexes were
valid/ready and used by read-only production plans. Earlier documents describing
009 as pending are historical. The deployment preserved existing ledger entries,
constraints and trigger settings without writing business rows. The [rollout and
branch compatibility audit](reviews/009-page-indexes-2026-10-30.json) remains the
record of that deployment and the older branch findings.

Migration 018 adds a transaction-local exception for the preserved own-task edit
endpoint. It preserves all trigger enable states and does not modify business
rows or manual-call history. The original API keeps the overhaul's completion
validation. New allocation and dispatch skip registered warehouse contacts;
reopening a registered warehouse remains a conflict, and existing work stays editable.

Production currently retains disabled `bolna_assignment_quality_guard` and
`bolna_assignment_contacts_sync` triggers from the prior app rollback. This merge
supports that state as well as a fresh database with the triggers enabled.
`rollback-handoff.sql` is retained to reproduce the old configuration in isolated
rehearsals; do not rerun it as part of the forward deployment.

```bash
# TEST_DATABASE_URL must point to a disposable local cluster.
node tests/rehearse-shared-schema.mjs 707f7971fa6982b73e502d3ef8cc3ee778b54848
```

The rehearsal upgrades a fresh copy of the deployed 001–017 schema to 018, verifies
that previous ledger rows and both 009 indexes are unchanged, runs the employee
and shared-schema regressions, and drops its temporary database. CI runs this in
addition to the complete fresh-schema integration suite.

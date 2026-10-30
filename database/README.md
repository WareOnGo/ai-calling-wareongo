# Database migrations

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

The migration runner serializes itself with a transaction advisory lock, runs
DDL and ledger writes in one transaction, and records SHA-256 checksums in
`bolna_schema_migrations`. A later run is a no-op unless a new file was added.
Changing an applied file is rejected. Add another numbered migration instead.
Lock waits are limited to two seconds and statements to thirty seconds; a timeout
rolls back the transaction. Inspect contention before retrying rather than leaving
a DDL request queued indefinitely behind production traffic.
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

## Compatibility with the retained shared schema

Migration 009 was deployed separately on 30 October 2026 at 16:30 IST. Baseline
and all migrations 001–017 match commit
`707f7971fa6982b73e502d3ef8cc3ee778b54848`. Both pagination indexes are valid and
ready, and read-only production query plans use them. The rollout preserved all
earlier ledger entries, constraints and trigger settings and wrote no business
rows. It did not merge or deploy the overhaul or Callyzer application code.
Earlier rollout records that leave 009 pending describe the state before this
deployment. See the [deployment and branch audit](reviews/009-page-indexes-2026-10-30.json).

The Callyzer columns/tables, manual history and warehouse sync tables can remain
in the database while this branch runs the original dashboard. They do not
require deploying the overhaul or its Callyzer endpoints.

The existing compatibility settings from `rollback-handoff.sql` remain required:
`bolna_assignment_quality_guard` and `bolna_assignment_contacts_sync` are disabled.
Assignment audit/history triggers and both warehouse guards remain enabled.
Do not disable warehouse guards or reapply/roll back migrations to accommodate
the old app. Existing assignments remain editable and completable. New assignment,
reassignment, reopening or AI dispatch involving a registered warehouse contact
returns HTTP 409 with a useful message. A rejected bulk selection rolls back in
full; remove the affected contacts before retrying. No provider request is made
for a dispatch rejected by the database guard.

Rehearse this schema separately from the ordinary fresh-main integration tests:

```bash
# TEST_DATABASE_URL must identify a disposable LOCAL PostgreSQL cluster.
# The supplied schema commit must already be available in the Git object store.
node tests/rehearse-shared-schema.mjs 707f7971fa6982b73e502d3ef8cc3ee778b54848
```

The rehearsal creates and removes a separate test database, reads the committed
migration files into a temporary directory, applies the existing compatibility
SQL there, and runs main's integration suite plus shared-schema regressions. It
also verifies that main's migration runner preserves the extra ledger entries
and that both 009 indexes remain valid and ready. It does not load `.env.local`, install production jobs,
copy feature migrations into this branch, or contact calling providers.

### Other branches checked after 009

The audit used committed branch versions in isolated checkouts and disposable
databases. Existing working-tree edits were excluded. The overhaul's normal
integration suite uses its full enforcement settings; separate runtime probes
use the two disabled legacy triggers matching production.

| Branch/version | Compatibility finding |
| --- | --- |
| Production main runtime `b02793d` | All 105 shared-schema integration tests passed with 009 applied. |
| `codex/bolna-visual-overhaul` at `707f797` | All 409 integration tests passed on its fully migrated schema. Grid reads and guarded reassignment also passed with production's legacy trigger settings, and its migration runner was a no-op. |
| `codex/bolna-ingestion-compat` at `14f46e9` | Five warehouse-guard API regressions return HTTP 500. It lacks main's `b02793d` error-handling fix. The old merge-helper branch at `c60cb05` has identical application source. |
| `codex/bolna-db-fixes-preserved` at `4eaf25b` | Grid reads and atomic guarded reassignment passed. Its migration runner rejects the newer 009–017 ledger entries; it must be updated before reuse as a deployment branch. |
| Local `main` at `d3dc7d2` | Still older than production main: it lacks the later AI ingestion, batch polling and warehouse-error fixes. Grid/reassignment smoke checks passed, but this is not the current production checkout. |
| `backup-before-reword` at `1962466` | Calls still reference the removed `assignment_attempts` column. A failed guarded reassignment also leaves the old assignment dropped. Both failures reproduce without 009. |
| `backup-before-squash` at `8134c05` | Reads passed, but a failed guarded reassignment leaves the old assignment dropped. The same failure reproduces without 009. |

The backup branches' reassignment writes predate transaction protection. These
failures and the older API/runner gaps are not caused by the pagination indexes.
Keep the backups as historical snapshots; do not deploy them over the current
shared database. No branch was merged as part of this migration rollout.

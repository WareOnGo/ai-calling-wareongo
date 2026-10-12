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

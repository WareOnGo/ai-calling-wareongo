# Production migration and adversarial review

Review date: 25 September 2026. Scope: parallel Hindi/English dispatch, legacy
dashboard compatibility, schema adoption and database access.

## Findings corrected

| Finding | Correction and verification |
|---|---|
| An older browser tab omits the language field and could unintentionally authorize English calls. | Omitted `routingMode` retains Hindi-only behavior; the current UI explicitly selects Auto. Integration regression covers a mixed-state legacy request. |
| An older server can accept an intent while a new server waits for its reservation lock. | Recheck legacy intents inside the transaction. A controlled concurrent test proves no provider request occurs. |
| Two spellings of the same UUID could be accepted as different agents. | Normalize agent IDs before comparison; regression verifies rejection before any dispatch. |
| A schedule near the provider minimum can expire during upload. | Allow four minutes initially, including the two-minute dispatch budget. Boundary tests cover the upload delay. |
| Supabase default grants can expose new operational tables; the existing owner-executed call view also had broad API grants. | Migration 004 enables operational-table RLS and removes `anon`/`authenticated` access to those tables and the view. Server-owner access remains. |
| Production predates the migration ledger and lacks `inferred_district`, despite the fresh baseline having it. | Rehearse adoption of the entire pending sequence; migration 005 adds the missing field without replacing existing data. |
| Waiting indefinitely for DDL locks can disrupt requests. | Migration lock waits are limited to two seconds; statements to thirty seconds. A forced lock conflict verifies full rollback. |
| The local production connection lacked the Supabase CA. | Use the downloaded CA with certificate/hostname verification enabled; configure `DATABASE_SSL_CA` locally. Hosting must also have the CA before deploying the updated app. |

## Validation

- Restored an app-only production schema snapshot into isolated PostgreSQL in
  Podman. No production rows were copied into the test environment.
- Compared existing fixture rows and all existing analysis-view fields before
  and after adoption. Verified old webhook INSERTs and old dashboard queries.
- Verified failed lock acquisition leaves no ledger or partial column changes.
- Verified replay is a no-op and API roles cannot directly read the protected
  tables/view, while the dashboard's server role can.
- Passed 82 unit tests, 30 integration tests against the upgraded production
  schema, TypeScript checking and the production build.
- Rehearsed the exact production procedure, which checks migration checksums,
  schema drift, active legacy work and existing-data fingerprints before commit.

## Production application

Applied migrations 001–005 and recorded the existing baseline without replaying
it. Commit confirmed at 2026-09-25T09:25:56.403Z; the guarded run took
36.982 seconds.

Before commit, fingerprints of every original column matched across all nine
existing application tables and the complete analysis view. This includes all
4,922 call logs, 58,821 source records and 10 existing batches. The migration
created zero dispatch requests; 1,454 existing batch contacts were reserved.

Post-commit checks at 2026-09-25T09:30:24.970Z confirmed the migration checksums,
verified TLS using the configured CA, old/new SQL compatibility, denied anonymous
view access, and HTTP 200 from the live health endpoint (`db: up`, `pending: 0`).

The application deployment is separate. Configure `BOLNA_ENGLISH_AGENT_ID` and
`DATABASE_SSL_CA` in the hosting environment before deploying the updated app;
both are configured locally. No provider calls were launched and agent speech
settings were unchanged. Direct access to the protected view/tables using
Supabase `anon` or `authenticated` roles is intentionally denied; the dashboard
continues through its authorized server connection.

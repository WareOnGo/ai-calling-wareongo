# Shared production and preview ingestion

The visual preview and production use the same database. Callbacks and scheduled
workers still run at `https://ai-calling-wareongo.vercel.app`. The new attempt
history therefore requires compatible ingestion at that production URL; deploying
the preview alone does not update the callback or worker code.

The production-only patch accepts `call-disconnected` → `completed` at the same
retry number, merges sparse updates for the same provider dial, records dial
evidence in `bolna_ai_attempts`, and fences outdated workers. Duplicate or older
deliveries do not reprocess a completed snapshot. The worker and recovery command
share the same provider-column writer; manual annotations and assignments are
excluded from its update list.

## Deployment

Deploy this ingestion patch on the existing production branch. It contains no
dashboard redesign or assignment-policy changes. Keep the existing webhook,
worker URLs and credentials. No environment variable changes are needed.

Migration `010_ai_ingestion_compat.sql` supplies only the AI table and helpers on
a fresh/legacy 001–005 database. On the shared database, 006 already supplies
these definitions; 010 uses compatible definitions and preserves existing data.
Apply through the production patch's migration runner, which has no pending
handoff-policy migrations. Do not re-enable disabled assignment triggers or run
the preview's unrelated pending migrations as part of this repair.

## Recover an existing batch

Run from a trusted checkout with development dependencies installed. The CLI uses
the existing Vite loader to run the same application functions as the worker.
Supply the intended environment explicitly; credentials are not printed.

```sh
# Read-only comparison: no writes and no calls scheduled.
node --env-file=<env-file> scripts/recover-batch-history.mjs <local-batch-uuid>

# After the compatible production ingestion is deployed:
node --env-file=<env-file> scripts/recover-batch-history.mjs <local-batch-uuid> --apply
```

Recovery first preserves identifiable dials from retained call and webhook
snapshots, then reads [Bolna's paginated batch executions API](https://www.bolna.ai/docs/api-reference/batches/executions_v2)
in pages of 100. Providers without that endpoint fall back to one bounded legacy
snapshot read (maximum 100 MiB), still written in pages of 100. Authentication and
server failures do not trigger fallback. Each page commits independently. Rerun after an interruption;
the provider identities and ordering checks prevent duplicate dials, stale
overwrites or repeated inference invalidation. Valid existing inference is kept
when its inputs have not changed; genuinely changed inputs follow the normal
worker's invalidation and enrichment process.

Provider requests are GET-only. Recovery does not create, schedule or retry
calls, change batch state, release reservations, or change manual work. Scheduled
and rescheduled executions do not count as dials. An active unchanged worker
lease is deferred; its worker or a later recovery run completes it. Historical
attempts with no retained provider identity cannot be reconstructed from a retry
counter, so the command does not invent them.

Verify the repaired batch's attempt count, completed durations/recordings and
unchanged manual assignments. Run the comparison again; an unchanged provider
snapshot should report zero updates. Bolna may still have pending work, so repair
of the reporting data is not evidence that the entire batch is complete.

## Verification for the October 2026 repair

The production branch passed typecheck, 97 unit tests, all 77 integration tests
and a production build. The preview branch passed typecheck, 120 unit tests and
110 affected integration tests. The same migration was exercised on both a fresh
legacy schema and the existing preview schema, including preservation of disabled
assignment triggers.

The read-only comparison for local batch `61a02ad7-ed36-41f2-ad6d-7a36246a6d84`
read 6,768 retained snapshots and 3,763 provider execution records. It identified
1,996 terminal snapshots to update; 379 scheduled/rescheduled records remain
pending and are not converted into dials. The provider still reports the batch
as running. This preflight did not change the shared database.

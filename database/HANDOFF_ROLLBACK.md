# Bolna handoff rollback — 12 October 2026

The rollback reverses commits `3eca75b` and `8fb7597`, restoring the application and dependencies to `fd5ceb1`. The shipped fixes and unfinished usability work are preserved on [codex/bolna-db-fixes-preserved](https://github.com/WareOnGo/ai-calling-wareongo/tree/codex/bolna-db-fixes-preserved). The unfinished operational changelog/PDF is not a release announcement.

## Database compatibility

Production migrations 006–008 were applied before the rollback request. An app-table backup was archived before migration and its archive listing verified; a restore was not rehearsed. The rollback deliberately retains migrated tables, columns, indexes, historical records and the migration ledger. It does not restore an older backup or delete work recorded since migration.

Apply [rollback-handoff.sql](rollback-handoff.sql) once using the intended production connection with certificate verification. It is safe to repeat. The transaction has a two-second lock timeout and a 30-second statement timeout; a lock conflict aborts without partial changes. It:

- Disables the new assignment-quality trigger because the old app cannot log the attempts required for completion.
- Disables the new shared-phone ownership trigger because the old allocation workflow operates per listing/call.
- Restores the earlier `bolna_availability` classification function, including the earlier busy/no-answer classification.

All other triggers, authorization controls and per-entity assignment uniqueness remain in place. The old app retains its earlier validation and behavior. In particular, its existing unsaved-draft navigation blocker predates these two commits and remains.

Fresh development/CI databases still use baseline plus migrations 001–005. Production intentionally has additional retained schema. Do not delete ledger entries or repurpose migration numbers 006–008. The old migration runner cannot certify or undo the retained handoff schema; do not use it as a rollback mechanism.

## Verification and execution

The compatibility SQL was applied to production on 12 October 2026 after a local rehearsal. Migration checksums matched the preserved branch. Both intended triggers are disabled, the two audit triggers remain enabled, and the restored classification function was verified. Before/after counts were unchanged: 1,700 assignments, 2 manual attempts, 7 assignment-history entries, 7,281 AI attempts and 15,329 call rows. No application rows were deleted or rewritten by the compatibility rollback.

The restored application passed typecheck, 97 unit tests, 30 integration tests against the migrated local database, and a Next.js 15.5.19 production build. A production-build Playwright smoke check passed caller result/WH/notes saving, Done, navigation after save, persistence, reopen, four admin pages and the old assignment API. The first browser smoke attempt used an admin-only navigation link while signed in as a caller; the corrected caller-navigation check passed in full. No live calls were placed.

## Before a future handoff deployment

1. Start with the preserved branch and complete its outstanding usability work and verification.
2. Review assignments and call-row edits made during the rollback period, including shared-phone ownership and older completion rules. Retained manual-call history remains available, but the old app does not add new manual-attempt events or update the newer assignment projections.
3. Reconcile call-row onboarding values with assignments explicitly. The legacy-onboarding migration is already recorded and will not rerun automatically.
4. Restore the preserved branch's `bolna_availability` function and re-enable `bolna_assignment_quality_guard` and `bolna_assignment_contacts_sync` in a coordinated app/database rollout after reviewing existing data.
5. Run retained-payload recovery with `--restart` to catch up AI evidence from older app traffic. Keep the original migration files and checksums unchanged.
6. Verify assignment writes, completion, reopen, ownership, provider ingestion and page rendering before restoring normal operations.

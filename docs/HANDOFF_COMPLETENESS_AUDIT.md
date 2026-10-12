# Handoff verification audit

Scope: all 22 original handoff items, three review rounds and two subsequent completeness audits. The original DOCX was reread and its SHA-256 matched the checklist. The technical verification record is maintained here; the [operational changelog](../BOLNA_DB_FIXES_CHANGELOG.md) explains the workflows for callers and managers. The [checklist](../BOLNA_DB_FIXES_PLAN.md) retains external acceptance work.

Both completeness audits found and fixed further correctness gaps. The second pass deliberately tested event ordering and partial metadata, rather than relying only on existing passing scenarios. Deployment acceptance and the design tradeoffs below remain explicit.

## Usability follow-up — 12 October 2026

The reported sequence was a saved RNR attempt followed by an Available dropdown edit and WH ID. The completion gate correctly required another call, but exposed only a generic error, while the call form offered a technical Event selector and irrelevant fields. The UI now explains the saved-result / last-call distinction and opens a guided call form from Mark done. A new connected call, its reference and completion can save in one transaction; failure rolls back both operations. Existing call requirements, Done-edit validation and the agreed Exhausted policy remain intact.

Corrections are a separate action. RNR, busy and unreachable calls hide result and conversation-duration inputs; callbacks require scheduling. Hidden draft values are cleared when the disposition changes. Edited call forms ask before closing without saving. Assignment actions, ownership filter chips and Team evidence/CSV use readable labels.

The complete browser and usability verification results are recorded below once the final run has finished. Earlier audit counts below describe their own release snapshots.

## Reproduce the checks

Use the dedicated disposable local database and fake provider credentials supplied by the tracked stage runner. Database-mutating stages must run sequentially.

```bash
npm run check
npm run test:stage -- rehearsal
npm run test:stage -- integration
npm run test:stage -- build
npm run test:stage -- browser-production --output=/tmp/bolna-audit5-browser-results
npm run test:stage -- performance audit5
npm run test:stage -- browser-volume-production
```

The rehearsal creates separate temporary databases. Rebuilding the performance fixture replaces only the disposable fixture, which the normal browser suite reseeds. No live calling or production writes are part of these checks.

## Second completeness-audit findings and fixes

| Finding | Reproduced behavior | Fix and coverage |
| --- | --- | --- |
| Latest-call correction retained an older attempt result. | Record Available, record a later call with Keep existing result, then correct that later call to Unavailable: the assignment stayed Available and completion incorrectly demanded a WH ID. | An explicit correction to the latest call can replace an inherited attempt result. Independent dropdown verification remains intact. Integration tests cover both cases; the browser covers the caller workflow through completion. |
| Sparse inbound metadata changed contact identity. | An inbound dial linked to the customer moved to the agent's destination number when a later delivery omitted direction. Correcting direction alone also left the old phone projection behind. | A shared SQL helper derives contact identity from the accepted merged snapshot for both inserts and updates. Tests verify inbound contact history after sparse updates and direction corrections. |
| Partial nested retry metadata discarded valid updates. | A retry identified by `batch_run_details.retried` lost its counter when a later metadata object omitted or nulled that field. The ordering guard then ignored the newer update. | Merge batch-run fields alongside telephony fields. Tests cover null objects, null retry fields and unrelated metadata updates, through webhook capture and the worker's call-log write. |

Review the [manual-result projection](../src/lib/manual-attempts.ts), [merged AI snapshot functions](../database/migrations/006_handoff_schema.sql), [manual regression cases](../tests/integration/review-followup.test.ts), [AI integration cases](../tests/integration/ai-attempts.test.ts) and [caller browser workflow](../tests/browser/tests/28-review-final.spec.ts).

The first targeted run reproduced three failures across 58 cases; a second targeted probe reproduced two failures among three nested-retry variants. After the fixes, the full integration suite passed 239 cases. The unshipped schema was reapplied to a fresh disposable database and all five migration rehearsals passed; no applied production migration was edited or run.

The suspected superseded-event picker issue was ruled out: its endpoint already reads `bolna_effective_manual_attempts`. No redundant client filtering was retained. There are no changes to the agreed Exhausted policy, WH format, UTC/IST convention or five Team measures.

The final complete run passed 112 unit tests, 239 integration tests, five migration rehearsals, the production build and 213 production-browser tests. The two intentionally separate volume scenarios passed after rebuilding the 50,000-row fixture; all 19 benchmark workloads also passed. The production browser run used build `66QjC9m787yOH7UNV1MBE`. These are complete runs after the source changes, not totals assembled from focused reruns.

No further reproducible implementation blocker was found within this audit's scope. The changelog now includes these corrections and the complete-run evidence. No commit, push, deployment or configured production-database access was performed during this pass.

## Completeness-audit findings and fixes

Two additional correctness gaps were reproduced through the real write paths:

| Finding | Cause | Fix and regression evidence |
| --- | --- | --- |
| Correcting a mistaken Available attempt left Team credit behind. | Assignment audit snapshots copied the attempt's result and were counted as independent discoveries. | Available snapshots with an attempt source are excluded; effective corrected attempts supply their evidence. Integration and browser checks cover summary, evidence and CSV; independent dropdown discoveries remain supported. |
| Sparse terminal webhooks erased call-log facts, or were ignored on later retries. | The worker inbox used the sparse delivery directly, losing known fields and interpreting a missing retry count as zero. | The inbox reuses the accepted merge for the exact provider dial. Regression checks cover retry 0 and 2, earlier ringing metadata, recording changes, and isolation between separate retries. |

The initial reproduction run had three failures and 41 passes. After the fixes, the focused run passed all 45 cases. The complete-run record above supersedes these intermediate failures; focused passes alone are not treated as release evidence.

The first audit browser run had 211 passes, one failure and two intentional volume skips. The new correction test expected one Available discovery in a period containing another seeded discovery. Its reporting date was isolated before a focused verification and clean complete rerun; no application change was needed for that fixture error.

The audit also replaced Team's regex-based SQL dependency discovery with explicit typed dependency lists, removed unused Raw rent-filter state, and corrected the documented filter scope and confirmed-conversation definition. The changelog and PDF share one authored Markdown source.

## Design assessment and remaining tradeoffs

- The unused claims, database wallet cache, duplicate AI delivery ledger and nine extra Team metrics are absent from the consolidated implementation. There is one merged record per identifiable AI dial.
- Completion quality lives in the database function used by the API and guard trigger. The retry vocabulary still has SQL and TypeScript representations because both layers use it; a parity test checks agreement.
- Actual ownership allocation, reopening and dispatch reservation still serialize through an advisory lock. Previews, notes, attempt logging and provider network requests do not hold it. Real deployment contention remains a staging measurement.
- Manual corrections and assignment audit history remain append-only. They support attribution and correction provenance but add query and storage cost; retention or archiving is future operational work.
- Reconciliation resumes committed database pages, but the provider still returns a complete snapshot. A changed snapshot restarts an idempotent replay. This does not bound provider response size.
- The wallet cache is process-local, so multiple application instances can refresh independently. Browser preference read failures fall back to defaults; database and provider failures have explicit error or recovery paths.
- Source imports outside the allocation flow do not automatically repair existing ownership conflicts. Warehouse checks validate format only. Neither limitation is presented as solved by the changelog.

These are bounded design choices and acceptance limits, not a claim that the code has no possible defects or maintenance debt. This audit is a handoff and regression review, not a penetration test or production-volume certification.

## Third-review regression evidence

- API and direct-SQL tests reject invalid Done result changes, cleared WH IDs, missing Unclear reasons and erased explanations. Legacy Done rows need no invented call; invalid references must be repaired. Reopening restores the new-completion prerequisite.
- Exhausted cannot bypass Available/WH validation or Unclear explanations. The agreed caller-controlled policy remains, with a required reason and no threshold beyond a logged retryable attempt.
- Correction chains retain the supplying event's result when Keep existing result is selected. Later explicit corrections still update the right assignment result.
- Batch cards and exports agree for every canonical final status, including call-disconnected. Unknown/in-progress statuses remain pending.
- UTC parsing is tested on UTC, IST and New York Node hosts and a non-UTC PostgreSQL session. Explicit offsets retain their instant; invalid calendar dates remain unknown. Browser checks cover IST display and readable intervals on desktop/mobile.
- Shared-contact Completed history includes sibling Raw listings and Calls, with matching caller filters and CSV rows. Team rejects all nine retired metric selectors.
- Reconciliation tests inject failure after a committed 250-row page and forbid replaying that page on retry. A 1,001-execution snapshot yields then resumes, survives provider reordering, resets on changed contents, recovers an expired lease and lets cron visit other batches. Reservations remain until completion.
- Migration rehearsals cover fresh, legacy, through-005, interrupted recovery and online-index timeout/retry. A writer is held beyond two seconds during index retry; the final index is valid. Retired development history is refused. Co-tenant data and legacy onboarding are preserved without invented dates.
- Validation drafts retain Result/Closure choices so dependent fields remain available. Failed Done actions and network failures still roll back. Existing autosave recovery tests run alongside the new browser cases.

## Runs that were not final evidence

The first third-review integration run had four failures: two expectations described the previous WH/time behavior, one cursor fixture used a different ordering, and one fixture lacked a UUID cast. They were corrected before the clean complete integration run.

The first focused browser run had ten passes and four failures. Two were locator mismatches. Validation recovery testing also exposed that rolling back an Unclear selection hid its required closure field. That UI path was fixed with unit and browser coverage. A later recovery run exposed a Retry click lost when textarea blur unmounted the button; the button now preserves focus until the retry is submitted.

The first complete browser run had 209 passes, two failures and two intentional volume skips. Its failures were an outdated raw-seconds expectation and a loading selector that also matched a hidden streaming fallback. Both checks were corrected before rerunning the complete suite. Only the later clean complete run counts as final browser evidence; volume scenarios run separately on their own fixture.

## Read-only configured-database audit

The earlier stored-payload audit used a read-only transaction and printed counts only. It sampled 10,000 call payloads and 10,000 webhook payloads: 7,512 and 9,152 respectively had unqualified dial timestamps; the rest lacked a dial timestamp. No sampled timestamp supplied a timezone. Supplied durations were numeric. This bounded, non-random sample does not prove every historical shape or the provider timezone.

The follow-up `database/audit-provider-shapes.mjs --legacy-only` also used a read-only transaction and printed only aggregate counts:

| Source | Total rows | Nonblank WH references | Non-integer legacy references |
| --- | ---: | ---: | ---: |
| Assignments | 1,700 | 61 | 0 |
| Call logs | 15,328 | 0 | 0 |

These are point-in-time counts, not a deployment-volume rehearsal. No credentials, names, numbers, transcripts or individual IDs were printed.

## Acceptance boundaries

The local benchmark is synthetic. Representative staging migration/restore, provider timezone confirmation against a known call, real retry-chain/agent checks and production traffic measurements remain operator acceptance. External WH existence and overwritten/unlogged history cannot be verified by this app. There are no down migrations; follow the [runbook](DEPLOYMENT.md).

The operational PDF is generated from the Markdown changelog. Selected screenshots use synthetic data. Rendering checks image loading and page bounds; visual review of the final edition is recorded with the usability verification above.

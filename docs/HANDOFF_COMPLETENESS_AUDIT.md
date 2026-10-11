# Handoff verification audit

Scope: all 22 handoff items and both code reviews. [Checklist](../BOLNA_DB_FIXES_PLAN.md), [changelog](../BOLNA_DB_FIXES_CHANGELOG.md), [deployment runbook](DEPLOYMENT.md).

## Complete-run ledger — 11 October 2026

| Check | Result |
| --- | --- |
| TypeScript and unit tests | Passed; 100/100 unit tests. |
| Database/API integration | 210/210 passed in one complete run, including 31 second-review regressions. |
| Migration runner rehearsals | 4/4 passed: fresh, legacy, pre-handoff and interrupted migration 015. |
| Production build | Passed, including the browser-discovered stale-revision fix. |
| New production browser regressions | 7/7 passed as part of the final full run. |
| Performance benchmark | One passing test completed all 19 workloads on the 50k/10k/5k fixture, including selective index-plan verification. |
| Separate volume browser | 2/2 passed, including repeated streamed pages at 1.5 Mbps and 20 ms latency. |
| Full production browser | 204 passed, 0 failed, 2 volume-only scenarios intentionally skipped; one complete run after the final source edit, in 4.3 minutes. |

Only complete runs count as full-suite evidence. All automated database tests use disposable local databases and fake provider credentials. No production writes or live provider calls were made.

## Important regression evidence

- The actual migration runner fails after 015's schema commits and its first backfill cursor commits, then reruns successfully to 019. Fresh/legacy upgrades preserve co-tenant data, legacy references and unknown verification dates.
- Done validation applies on transition: legacy notes/result edits succeed in both API and SQL tests. New completion without a call fails. All five retry dispositions permit explicit Exhausted closure only with a logged attempt and a reason.
- A dropdown result survives Keep existing result and older corrections. Integration testing caught one remaining correction overwrite; browser testing caught immediate post-log edits using the previous revision. Both received fixes and passing regressions, including a deliberately delayed browser refresh. Correcting the latest call can also supply its previously unknown result; it cannot overwrite another existing choice.
- Dispatch loads expensive metadata before acquiring the lock; a concurrent owner created during that gap prevents provider dispatch. Queue CSV rechecks eligibility at download.
- Reconciliation accepts null/string metadata and commits in pages. Injected failure during a 501-execution run leaves exactly 250 dials committed and reservations intact; replay finishes without duplicate dials.
- Provider-clock intervals cross midnight correctly, keep incompatible clocks separate and resist older sparse updates. Shared-contact completed/Never assigned filters, balance-low exclusions, historical WH reporting, city aliases and identity-only fuzzy search have regressions.
- Default Team SQL includes only the five requested branches; selected evidence builds only its dependencies. SQL/TypeScript retry vocabularies are checked for agreement. Removed claims/cache/delivery-ledger objects are absent after migration.

The first new browser run had four passes and three selector failures. Correcting those selectors exposed the stale-revision defect above; the subsequent seven-case run passed. The first complete browser run then had 203 passes and one failure: correcting the latest call could not fill its previously unknown result. That code path was fixed and two integration regressions added. A later 204-pass run was followed by wording-only corrections; the wording rerun caught a remaining old saved-view shortcut label. That label was corrected. Earlier failed and focused runs are not represented as clean full-suite results.

## Read-only configured-database audit

The earlier stored-payload audit used a read-only transaction and printed counts only. It sampled 10,000 call payloads and 10,000 webhook payloads: 7,512 and 9,152 respectively had unqualified dial timestamps; the rest lacked a dial timestamp. No sampled timestamp supplied a timezone. Supplied durations were numeric. This bounded, non-random sample does not prove every historical shape or the provider timezone.

The follow-up `database/audit-provider-shapes.mjs --legacy-only` also used a read-only transaction and printed only aggregate counts:

| Source | Total rows | Nonblank WH references | Non-integer legacy references |
| --- | ---: | ---: | ---: |
| Assignments | 1,700 | 61 | 0 |
| Call logs | 15,328 | 0 | 0 |

These are point-in-time counts, not a deployment-volume rehearsal. No credentials, names, numbers, transcripts or individual IDs were printed.

## Remaining acceptance boundaries

The local benchmark is synthetic. A representative staging migration/restore rehearsal, live provider timezone/retry-chain checks and production traffic measurements remain operator acceptance work. External WH existence and overwritten/unlogged history cannot be verified by this app. See the runbook for forward recovery and the lack of down migrations.

The shareable PDF embeds final-run screenshots. Its generation checks image loading and page-content bounds; all eight rendered pages were visually inspected. Selected screenshots and verification metadata are tracked with the authoring source.

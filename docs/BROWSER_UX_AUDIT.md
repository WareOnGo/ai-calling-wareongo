# Browser verification

The tracked Playwright harness in [tests/browser](../tests/browser/README.md) drives the production build with synthetic fixtures. Exact complete-run counts are recorded in the [verification audit](HANDOFF_COMPLETENESS_AUDIT.md). Large traces may be placed under `/tmp` using Playwright's `--output` option; the source and tests remain in the repository.

## Operational usability review — 12 October 2026

The audit covers every feature in the operational changelog, grouped by the task a caller or manager performs. It combines actual browser interactions with the API/database tests that enforce the workflow. All browser data is synthetic; providers are mocked.

| Workflow / handoff items | Usability finding and action | Browser coverage |
| --- | --- | --- |
| Assignment and ownership — H01, H03, H20, H22 | Preview action codes needed readable labels. Unassigned's label now states that completed work is excluded; selected scope, retained owners and workload distribution were checked. | 16, 17, 26–29 |
| Call logging and manual results — H02, H09, H17 | Event mixed correction with new work. Corrections now have a separate action; RNR hides conversation fields; callbacks ask for a due time. Last-call and saved-result context explain why work remains open. | 18, 25, 27–29 |
| Completion and reopening — H18, H19 | Available + WH ID after RNR produced a dead-end error. Mark done now guides logging or correcting the call. New-call completion saves atomically, while WH/Unclear/Exhausted validation remains enforced. | 18, 25, 27–29; integration manual-lifecycle |
| Filters, columns and navigation — H04, H05, H11, H12, H15, H16 | Ownership and area/onboarding/rent chips needed readable values. Multi-select, city aliases, saved views, column controls, page jump and Needs AI review explanations were checked. The v2 analytics dashboard stays out of scope. | 03, 11, 14–15, 19, 25–29 |
| AI history and default activity — H06, H13, H14 | Timeline time/interval readability, mobile bounds, known-history limits, separate manual/AI results and hidden read-only legacy Called By were checked. | 18, 20, 25–28 |
| Calling queue and balance — H01, H03, H08 | Human ownership and eligible CSV agree; balance failures remain visible; live dispatch has its own confirmation. | 16, 21, 26–27 |
| Batches — H10 | Readable allocations, original versus current ownership, cards and matching exports were checked. | 21, 25, 28 |
| Team reporting — H21 | Supporting rows and CSV exposed raw disposition codes; they now use readable labels. Date ranges, all five measures, duration coverage and drill-downs were checked. | 23, 25, 27–29 |
| Responsiveness and recovery — H07 and cross-cutting | Tested short/mobile screens, both themes, reachable dialog controls, keyboard dismissal, slow saves, retained failed inputs, lost-response idempotency and stale-response isolation. | 14, 15, 24, 25, 29 |

The production database catch-up is recorded in [DEPLOYMENT.md](DEPLOYMENT.md). New UI changes are not yet deployed. Browser checks are local acceptance evidence, not proof of live calling or external warehouse-ID validity.

## Review regressions

`27-review-followup.spec.ts` covers legacy Done note/result edits, explicit Exhausted closure, Keep existing result after a dropdown change, UTC-to-IST times and intervals across midnight, CSV eligibility and fresh ownership checks, legacy call-row references and readable follow-up/Team views. Its delayed-refresh test exposed a stale-version save; row editing now waits for the refreshed version. The full suite also exposed a correction that could not fill the latest call's previously unknown result; integration and browser coverage verify that fix.

`28-review-final.spec.ts` adds Done-edit validation and field recovery, invalid legacy-reference repair, Exhausted/WH checks, Keep existing result corrections, final-status batch cards, shared-contact completed filters and readable labels. It also checks that correcting a mistaken Available attempt removes Team credit from the summary, evidence and CSV. Validation recovery preserves the Result/Closure draft so its required fields remain available.

The second completeness audit adds the sequence Available call → later Keep-existing call → explicit Unavailable correction. The browser checks the corrected assignment result and successful completion through the real caller controls.

Earlier coverage remains in suites 18, 20, 25 and 26: no-call/RNR completion bypasses, integer-ID validation, corrections, canonical Calls onboarding, hidden/read-only legacy columns, alternate-number ownership, mobile history bounds, lost-response idempotency, failed-save recovery, retained drafts and accessible dialogs in both themes.

## Screenshots inspected

- [Unanswered-call form](browser-audit/operations-rnr.png)
- [Available completion in the call form](browser-audit/operations-complete.png)
- [Separate call correction](browser-audit/operations-correction.png)
- [Assignment preview](browser-audit/operations-assignment.png)
- [Queue ownership and eligible CSV](browser-audit/changelog-queue-dialog.png)
- [IST dial times and intervals](browser-audit/changelog-provider-history.png)
- [IST history on mobile](browser-audit/review2-provider-intervals-mobile.png)
- [Explicit Exhausted closure](browser-audit/review2-exhausted-work.png)
- [Legacy Done row remains editable](browser-audit/review2-legacy-done.png)
- [Done edits retain completion validation](browser-audit/review3-done-validation.png)
- [Five-measure Team summary](browser-audit/operations-team.png)

The shareable [PDF changelog](../BOLNA_DB_FIXES_CHANGELOG.pdf) embeds selected captures with explanations. Its only authored source is the Markdown changelog. `docs/render-changelog.mjs` converts that source to the PDF; generated HTML stays temporary and no separate validation JSON is maintained. Run `node docs/render-changelog.mjs` after installing the tracked browser harness dependencies and making a compatible Chromium available. Set `EVAL_CHROMIUM_PATH` if necessary.

The renderer checks image loading and page-content bounds before writing the PDF. Generated browser reports and traces remain ignored; screenshots linked here are portable, selected evidence using synthetic contacts.

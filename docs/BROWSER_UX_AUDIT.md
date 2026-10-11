# Browser verification

The tracked Playwright harness in [tests/browser](../tests/browser/README.md) drives the production build with synthetic fixtures. Exact complete-run counts are recorded in the [verification audit](HANDOFF_COMPLETENESS_AUDIT.md). Large traces may be placed under `/tmp` using Playwright's `--output` option; the source and tests remain in the repository.

## Review regressions

`27-review-followup.spec.ts` covers legacy Done note/result edits, explicit Exhausted closure, Keep existing result after a dropdown change, UTC-to-IST times and intervals across midnight, CSV eligibility and fresh ownership checks, legacy call-row references and readable follow-up/Team views. Its delayed-refresh test exposed a stale-version save; row editing now waits for the refreshed version. The full suite also exposed a correction that could not fill the latest call's previously unknown result; integration and browser coverage verify that fix.

`28-review-final.spec.ts` adds Done-edit validation and field recovery, invalid legacy-reference repair, Exhausted/WH checks, Keep existing result corrections, final-status batch cards, shared-contact completed filters and readable labels. It also checks that correcting a mistaken Available attempt removes Team credit from the summary, evidence and CSV. Validation recovery preserves the Result/Closure draft so its required fields remain available.

The second completeness audit adds the sequence Available call → later Keep-existing call → explicit Unavailable correction. The browser checks the corrected assignment result and successful completion through the real caller controls.

Earlier coverage remains in suites 18, 20, 25 and 26: no-call/RNR completion bypasses, integer-ID validation, corrections, canonical Calls onboarding, hidden/read-only legacy columns, alternate-number ownership, mobile history bounds, lost-response idempotency, failed-save recovery, retained drafts and accessible dialogs in both themes.

## Screenshots inspected

- [Manual call dialog](browser-audit/changelog-manual-dialog.png)
- [Queue ownership and eligible CSV](browser-audit/changelog-queue-dialog.png)
- [IST dial times and intervals](browser-audit/changelog-provider-history.png)
- [IST history on mobile](browser-audit/review2-provider-intervals-mobile.png)
- [Explicit Exhausted closure](browser-audit/review2-exhausted-work.png)
- [Legacy Done row remains editable](browser-audit/review2-legacy-done.png)
- [Done edits retain completion validation](browser-audit/review3-done-validation.png)
- [Five-measure Team summary](browser-audit/changelog-team-table.png)

The shareable [PDF changelog](../BOLNA_DB_FIXES_CHANGELOG.pdf) embeds selected captures with explanations. Its only authored source is the Markdown changelog. `docs/render-changelog.mjs` converts that source to the PDF; generated HTML stays temporary and no separate validation JSON is maintained. Run `node docs/render-changelog.mjs` after installing the tracked browser harness dependencies and making a compatible Chromium available. Set `EVAL_CHROMIUM_PATH` if necessary.

The renderer checks image loading and page-content bounds before writing the PDF. Generated browser reports and traces remain ignored; screenshots linked here are portable, selected evidence using synthetic contacts.

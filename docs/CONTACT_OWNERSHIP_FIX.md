# Shared-phone assignment fix

This patch addresses the two reported ownership issues on top of the rolled-back app.

- **Unassigned** excludes rows with open or completed work, including work on another listing or call that shares a valid phone number. Dropped-only and never-assigned contacts remain eligible. The same rule applies to grids, counts, CSV exports and Assign all matching.
- **Assign** compares normalized phone numbers across Raw and Calls, including alternate listing numbers and inbound calls. It skips contacts already assigned or completed and deduplicates the selected rows by phone. The dialog reports owned, duplicate and missing-number skips separately.
- **Reassign** is explicit. It closes overlapping open assignments held by other callers and keeps their notes and history. Completed history stays intact. An already-open task held by the selected caller is retained. Assigning a completed contact again requires this option.
- **Reopen** refuses when another open task already covers the phone. Assignment and reopen checks share a transaction lock so simultaneous requests cannot acquire the same number. Notes, result changes, Done, reads and exports do not take this lock.
- **Assigned To** shows linked contact ownership. Notes, outcomes, edit IDs and employee visibility remain tied to the original row assignment.

No migration is required. The patch runs on baseline plus 001–005, and on production's retained 006–008 schema with the rollback compatibility changes. Do not re-enable the rolled-back completion or contact triggers as part of this deployment. The newer call-logging form, completion policy and other handoff features remain on the preserved branch.

Protection covers application assignment and reopen routes. External SQL writes and source imports are not intercepted by a new database trigger; current imported phone mappings are checked at the next allocation/read. This release does not alter the separate Bolna AI queue/dispatch workflow.

## Verification

Final checks passed: typecheck, 97 unit tests, 61 integration tests on each of the original and retained-migration schemas, the production build, and all six Playwright regressions. Browser coverage includes the existing Result → WH ID → Done workflow and navigation.

The integration suite covers open/completed/dropped history, normalized and alternate phones, inbound calls, missing provider numbers with retained phone IDs, invalid numbers, cross-channel ownership, exports, all-matching selections, caller privacy, reassignment rollback, concurrent allocation and reopening, and ordinary saves while allocation is locked. A 20,000-row selection creates 10,000 tasks for 10,000 distinct numbers; another caller's request skips the entire already-owned selection.

Tests run against disposable local databases with fake provider credentials. Production inspection uses an explicitly read-only transaction and prints only counts and timings. The latest audit found one shared phone with 20 open tasks for Ranita and one for Manohari. These existing tasks are left untouched for manual review, as requested. Deployment does not choose an owner or clean up historical assignments.

To reproduce:

```sh
npm ci
npm run check
# Point these at a disposable local database; integration/browser tests reset fixtures.
TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:5432/postgres npm run test:integration
npm run build
npx playwright install chromium
TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:5432/postgres npm run test:browser
```

The browser runner supplies a local database and fake credentials to the app; it rejects remote test databases. `BROWSER_CHROMIUM_PATH` can select an installed Chromium. CI runs the tracked integration and browser tests on a fresh baseline database. Browser output is ignored by Git.

## Quick operational check

1. In Raw and Call Analytics, choose **Unassigned**. A number with completed or open work must disappear across its matching rows.
2. Assign several calls/listings sharing a phone. Review the dialog's duplicate and already-owned counts.
3. To move existing work, choose **Reassign existing contacts, including linked phone numbers**. Check the previous caller's open list and the selected caller's new task.
4. Continue the existing Result → WH ID → Done workflow. No manual-call logging step was added by this patch.

# Dashboard filter audit — 14 October 2026

## Warehouse matching review — 30 October 2026

**Warehouse DB match** filters the imported WAG phone associations in Raw Dataset,
AI Calls, Assignments, My Work and both batch types. Any/Yes/No use the same scope
for counts, pages, exports and all-matching selection. All associated WHIDs remain
searchable and are exported in a separate column, including ambiguous matches.
Saved Added to DB and staff-onboarding criteria retain their existing semantics;
a phone association does not silently replace a caller's saved verification.

Regression checks cover unassigned raw matches, alternate numbers, empty matches,
employee scope, My Work totals, CSV columns and applied filter chips. The new
filters and warehouse notices use the existing shared components and colors.
The [adversarial review report](warehouse-review-2026-10-30.json) records the
validation results and unresolved dependency advisories.

Application changes are maintained on `codex/bolna-visual-overhaul`. The development preview stays on port 3000. The filter layout needs no new environment variable or dependency. Migration 012 for the V2 manual tags was applied to the shared database with approval on 21 October 2026.

## Interaction rules

Use one compact toolbar pattern on every table: search, **Filters**, Apply, then view tools and work actions. Keep all categorical, date and reporting criteria together in the Filters panel, including assignee and status. Group related fields and show an applied count on the trigger. Apply the complete draft once, retain it when switching categories, and expose removable applied-filter chips plus Clear filters. This uses Carbon's guidance on batch filtering for complex queries and visible indicators for hidden filters. [Carbon filtering](https://www.carbondesignsystem.com/building-blocks/core/patterns/filtering)

Use checkboxes for multiple categorical values, searchable options for longer lists, and an explicit Any option for single-value fields. Multiple values within a category mean OR; separate categories mean AND. Keep chosen values visible after the menu closes. These choices follow PatternFly's enterprise filtering patterns. [PatternFly filters](https://www.patternfly.org/patterns/filters/design-guidelines/)

Dashboard-specific rules:

- Match the value actually reported in a column. AI context, manual outcomes and onboarding are independent criteria.
- Added to DB tests the stored flag; onboarded requires both the flag and a recorded WH reference. Do not silently substitute one for the other.
- Treat date ranges as inclusive calendar dates in IST. Validate the whole draft so both dates can move to a new period in one Apply. For reversed dates, area ranges or invalid references, keep the panel open, explain the error and focus the field in its category.
- WH ID matches one complete reference, including an ID inside a legacy comma-separated list. `261` does not match `1261`.
- “No calls logged” means no recorded manual events. It does not claim that no historical calls occurred.
- Reset the page when criteria change. Preserve repeated parameters on pagination, saved views, export and applicable bulk actions.
- Use the same server predicates for rows and totals. Always retain employee visibility restrictions.
- Keep controls labeled, maintain visible focus, fit panels to the viewport and retain reachable footer actions in both themes.

## Table coverage

| Surface | Filters available after this audit | Query / count behavior |
| --- | --- | --- |
| Assignments | Search, assignee, status; AI–human mismatch review, AI and manual result, AI attempt presence, Added to DB, WH ID, notes, manual calls logged and manual call status; channel, assigned by, city, geographic state, batch ID, follow-up, completion review; assigned and completed dates, order | All criteria run before pagination. Status cards show the breakdown within other criteria and retain them on navigation. Completion dates require an actual recorded completion; missing legacy dates are not invented. |
| Raw Dataset | Source, property, size and ownership; AI history result independently of latest AI result; verified AI attempts, execution records, latest call status/date/recording/transcript; manual result/status, Added to DB, WH ID, notes and manual activity; has-phone / no-phone | The history filter uses Available > Unavailable > Unclear, matching the displayed badge. Latest-call fields use the same most recent execution. Rows, all-matching selection, queue, assignment preview and CSV share predicates. |
| AI Calls | Outcome, review needed or not needed, connection, agent, direction, AI attempt presence, property including warehouse type, source listing match, dates, provider batch ID and ownership; Added to DB, WH ID, notes, manual activity/status, recording and transcript | Source choices include all linked listings. Property criteria must match the same listing. Reporting uses the visible assignment, with the legacy DB-field fallback for unassigned calls. Rows, count, IDs and CSV agree. |
| My Work — listings and AI follow-ups | Search, channel, manual result/status and follow-up; AI result and attempt presence, Added to DB, WH ID, notes, manual activity; city, geographic state, assigned by, assigned and completed dates, order | Both lists and status totals use the criteria within the signed-in caller's scope. Repeated manual statuses survive search, paging and status navigation. AI filters and displayed context share a source. |
| AI / manual batch catalog | Search batch ID / creator / provider ID, status; creator, caller, language or origin; created dates and references | Manual creator and caller are independent criteria. Repeated status choices survive pagination and CSV. Uses the shared filter panel, Apply and chips. |
| AI / manual batch members | Search contact / phone, result, call or assignment state, attempt presence, connected, city; original caller, current owner, allocation decision, onboarding and WH ID for manual batches | Member counts and CSV narrow together. Global progress cards remain whole-batch counts; selecting a card retains member filters. Clear filters retains the current card. |
| Team performance | All time, IST dates and presets, caller, current or removed access | Summary and evidence scope use the same member/access criteria. Date presets retain roster criteria. |
| Team evidence | Target, phone and evidence search; current task state, work type, recorded/unknown duration; caller and metric drill-down | Zero seconds is recorded duration, not missing. Pagination and CSV retain the complete evidence criteria. Clearing evidence criteria preserves the report context. |
| Access control | Name/email search; role and access status in Filters | The same Apply/chips interaction filters the loaded directory locally. Authorization checks and last-admin protections use the full directory, regardless of filters. These transient filters reset on reload. |

Other inspected surfaces: AI history already has contact/execution scope and provider-batch filtering. Record details, manual-call history and assignment/queue previews are scoped evidence or confirmation lists rather than global tables; they retain their existing scope and pagination without another filter toolbar. Loading tables mirror the corresponding page controls.

Assignments use an inline status breakdown and one result/review row above the table. Keep counts clickable and preserve the other applied criteria. Do not add separate full-height blocks for each notice, count and sort label. Team date presets edit the filter draft and take effect with Apply. Each filter form owns a unique dialog ID, including when performance and evidence filters share a page.

AI attempt presence counts recorded provider attempts, independently of legacy execution records. Applied choices remain represented even when they disappear from current option lists. Filter-option caches were versioned where their schema or source coverage changed.

## Shared header refinements

The navigation, page heading, loading state and related links now use **AI Calls**; the existing `/dashboard/calls` route is retained.

Bolna balance is one purple chip with a directly accessible refresh icon. The update timestamp and provider message are available on hover and to assistive technology; stale, low and unavailable states remain explicit. Balance is displayed as USD by dividing the raw wallet value by 100, matching the [official Bolna CLI](https://github.com/bolna-ai/cli/blob/main/internal/api/account.go). For example, 2,778.9521 becomes $27.79 USD. The cache and `BOLNA_WALLET_LOW_THRESHOLD` remain in the provider's raw cents, preserving existing alert configuration. No deployment configuration change is needed; the obsolete display-unit override is ignored.

## Verification and screenshots

Verified on 14 October 2026:

- Production build and TypeScript checks passed.
- 117 unit tests and 67 targeted integration tests passed. The team evidence suite passed again after adding phone search coverage.
- 61 Playwright tests passed across the filter audit, loading layout, personal work, batch and queue suites. These include filter persistence, count/export parity, invalid date handling, the USD chip and the AI Calls rename.
- The `filter-completeness` gallery contains 112 synthetic screenshots: 28 page/panel states at desktop and mobile sizes in both themes. Its manifest records exit code 0. Selected desktop and mobile captures were also inspected visually, including the balance chip, assignment results/dates, call details, property criteria, manual allocation and team evidence filters.
- The development preview returned HTTP 200 on port 3000. No changes were pushed or deployed.

Backend regression coverage lives in `tests/integration/filters.test.ts`, `batches-wallet.test.ts` and `team-report.test.ts`. It exercises repeated categories, empty values, cross-channel AI context, verified attempts versus execution records, matching properties within one listing, whole-reference matching, legacy fallbacks, employee scope, IST boundaries, export/count parity and raw-wallet-to-USD conversion.

`tests/browser/tests/39-filter-audit.spec.ts` exercises the new interactions and renders all affected pages and panels at 1366px and 390px in light and dark themes. It checks overflow, rendered contrast, applied chips, draft retention, category clearing, status-card navigation and export context. Existing filter, team, batch and loading suites also cover regressions.

The existing `bolna-eval/scripts/render-dashboard.mjs` wrapper accepts `--filters` to run this catalog through the application checkout. Use the disposable test database and the same environment documented in `DESIGN_SOP.md`, then add `--filters -g @render` to the render command. The output includes screenshots, manifests and a searchable `index.html` gallery. It uses synthetic fixtures and stubs provider requests.

From the application checkout, after `npm run test:stage -- build`:

```sh
EVAL_RENDER_DIR=../bolna-eval/shots/filter-completeness npm run test:stage -- render-filters
```

This command supplies the existing isolated test configuration and creates the gallery in bolna-eval. It does not use the port 3000 preview or the live database.

## V2 follow-up

Assignments and My Work use one source-listing fallback for displayed city, city filtering and geographic state filtering. The geographic parameter is `region`, separate from assignment `state` (Open/Done/Unassigned). Substring searches treat percent and underscore literally. Counts and bulk selection reuse the same criteria.

AI–human comparison lives in Filters → Results, with “Results disagree” shown as a removable applied filter. It compares explicit Available/Unavailable/Unclear results on the exact assigned AI execution. Unprocessed or failed calls and shared-phone property context are excluded. There is no separate mismatch tab.

Assignments supports per-page and all-matching selection with previewed Unassign/Reopen actions. The server checks admin access, revisions and contact ownership again when applying. Non-open/non-done rows, occupied or duplicated contacts, and inactive callers are reported as skipped. A stale preview causes a conflict without partial writes. Selection resets on filter/page navigation.

Manual call status filters include Owner unresponsive, Leased out and No property for rent. Migration 012 must be installed before the new tags are written. External warehouse phone matching remains deferred pending database access. CallOnGo is the application name; Bolna remains the call provider.

Regression coverage: `tests/integration/v2-features.test.ts` and `tests/browser/tests/40-v2-features.spec.ts`. The browser spec seeds the guarded local database directly and covers desktop/mobile filtering, bulk previews, manual logging, All time navigation and CSV.

### V2 adversarial review

The second review reproduced and fixed three omissions:

- Manual batch connection counts and exports still used the old disposition list. They now share `CONNECTED_DISPOSITIONS` with team reporting, including Leased out and No property for rent.
- Calls missing recipient metadata could show a source-listing name in My Work but lose that name in Assignments, search, sorting and manual batch members. These paths now share one fallback name and city, including all-matching selection and batch exports.
- Clearing an unapplied All time draft left date inputs disabled. Date values now use one React draft, reset to the applied range, and survive toggling All time on and off. The redundant Choose dates action and direct DOM date-value edits were removed.

The review also removed repeated verdict normalization and JSON encode/decode round trips in selection state. Bulk preview validation and ownership checks remain: tests cover changed revisions, new matching records, conflicting owners, duplicate phones, removed callers, employee access denial and selections spanning multiple pages. A completed AI call without an explicit verdict remains excluded from mismatch counts.

The PDF checklist was rechecked against manual batch IDs and member navigation, assignment attribution and dates, separate manual outcome/activity filters, geographic filters, timestamped manual history, USD balance, bulk selection, All time evidence/exports, and caller Open/Done workload links. Warehouse phone matching still requires external database access. Migration 012 is installed in the shared database; the application changes are maintained on the feature branch.

### Complexity review

The additional pass focused on work hidden behind small UI actions and duplicated responsibility:

- The assignee modal called the full assignment-table reader for one assignment. That performed a count query, pagination and AI-history aggregation before fetching the actual batch. It now uses one lookup for the displayed assignment fields, retaining the shared contact-name fallback. The batch reader still supplies membership and progress; there is no second implementation of those rules.
- AI batch lists counted legacy manual assignments on every load even though that count is displayed only on the manual tab. The legacy count now runs only for manual lists.
- Bulk requests parsed and normalized the same selection in both the HTTP route and the service. The route now decodes JSON; the service validates and deduplicates the request once for every caller. Malformed JSON, invalid selections and unauthorized requests remain rejected.

The ownership transaction, stale-preview hash, audit actor and 20,000-row bound were retained because removing them would weaken bulk-write correctness. Team evidence keeps explicit metric dependencies and shared event definitions so totals and CSVs agree without building every metric for a single drill-down. No new query framework, state library, cache or background worker was introduced.

Focused regression coverage includes legacy and batched previews, inbound phone numbers, source-name fallback, retained notes/dates, manual-only legacy counts, malformed bulk requests, duplicate IDs and stale ownership. These checks use disposable local data; they do not establish production latency improvements.

### Shared-schema verification — 21 October 2026

A read-only check confirmed the shared database's migration checksums and the two deliberately disabled assignment guards. Bulk reopening already verifies contact ownership in the application, but the single-assignment route relied on the disabled trigger. Local tests reproduced duplicate ownership for both raw-listing and AI-call reopen operations. The route now checks linked open work under the shared ownership lock, rejects the conflict without changing the assignment, and allows reopening once the previous owner is unassigned.

Migration 012 was rehearsed against the same disabled-trigger configuration, including retained manual evidence and audit rows, then applied by itself after explicit approval. Before/after fingerprints and a post-commit read verified unchanged data and trigger settings. Migration 009 was left pending. See the [database rollout record](../database/README.md#v2-manual-call-tags). No application code was pushed or deployed.

Validation passed: type checking, 120 unit tests, all 330 integration tests, the production build and all nine V2 browser scenarios. The browser conflict assertion was scoped to the assignment row to avoid matching Next.js's route announcer. The normal development preview returned HTTP 200 on port 3000; browser fixtures ran separately on port 3129 against the disposable database.

### Batch details and filter cleanup

Manual batch members show the original caller's notes, assignment instructions and dates, call status, follow-up time, closure reason, saved Added to DB flag and warehouse reference. Reassignment preserves the original assignment's details and shows the current owner separately. Logged calls open the shared details drawer on Manual activity. Completion warnings identify the failed rule while retaining the existing status colors.

The member export button was removed after checking the original requirements and V2; neither requested it. The existing export API remains available. AI–human mismatches use the Results filter and applied chip, without a separate tab in either the page or its loading state.

The latest follow-up passed type checking, 27 batch integration checks and three focused browser flows covering filter persistence, bulk selection reset, note expansion, call-history navigation and original-caller attribution. Browser checks use the disposable database on port 3129; the regular preview remains on port 3000.

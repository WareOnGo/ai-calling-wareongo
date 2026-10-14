# Dashboard filter audit — 14 October 2026

All changes are local to `codex/bolna-visual-overhaul`. The development preview stays on port 3000. This change needs no migration, environment variable or new dependency.

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
| Assignments | Search, assignee, status; AI and manual result, AI attempt presence, Added to DB, WH ID, notes, manual calls logged and manual call status; channel, assigned by, city, batch ID, follow-up, completion review; assigned and completed dates, order | All criteria run before pagination. Status cards show the breakdown within other criteria and retain them on navigation. Completion dates require an actual recorded completion; missing legacy dates are not invented. |
| Raw Dataset | Source, property, size and ownership; AI history result independently of latest AI result; verified AI attempts, execution records, latest call status/date/recording/transcript; manual result/status, Added to DB, WH ID, notes and manual activity; has-phone / no-phone | The history filter uses Available > Unavailable > Unclear, matching the displayed badge. Latest-call fields use the same most recent execution. Rows, all-matching selection, queue, assignment preview and CSV share predicates. |
| AI Calls | Outcome, review needed or not needed, connection, agent, direction, AI attempt presence, property including warehouse type, source listing match, dates, provider batch ID and ownership; Added to DB, WH ID, notes, manual activity/status, recording and transcript | Source choices include all linked listings. Property criteria must match the same listing. Reporting uses the visible assignment, with the legacy DB-field fallback for unassigned calls. Rows, count, IDs and CSV agree. |
| My Work — listings and AI follow-ups | Search, channel, manual result/status and follow-up; AI result and attempt presence, Added to DB, WH ID, notes, manual activity; city, assigned by, assigned and completed dates, order | Both lists and status totals use the criteria within the signed-in caller's scope. Repeated manual statuses survive search, paging and status navigation. AI filters and displayed context share a source. |
| AI / manual batch catalog | Search batch ID / creator / provider ID, status; creator, caller, language or origin; created dates and references | Manual creator and caller are independent criteria. Repeated status choices survive pagination and CSV. Uses the shared filter panel, Apply and chips. |
| AI / manual batch members | Search contact / phone, result, call or assignment state, attempt presence, connected, city; original caller, current owner, allocation decision, onboarding and WH ID for manual batches | Member counts and CSV narrow together. Global progress cards remain whole-batch counts; selecting a card retains member filters. Clear filters retains the current card. |
| Team performance | IST dates and presets, caller, current or removed access | Summary and evidence scope use the same member/access criteria. Date presets retain roster criteria. |
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

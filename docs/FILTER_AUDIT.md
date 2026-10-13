# Dashboard filter audit — 13 October 2026

All changes are local to `codex/bolna-visual-overhaul`. The development preview stays on port 3000. This change needs no migration, environment variable or new dependency.

## Interaction rules

Use a compact toolbar for search and the most common criteria. Put secondary criteria in a labeled panel; group related fields and show an applied count on its trigger. Apply the complete draft once, retain it when switching categories, and expose removable applied-filter chips plus Clear filters. This uses Carbon's guidance on batch filtering for complex queries and visible indicators for hidden filters. [Carbon filtering](https://www.carbondesignsystem.com/building-blocks/core/patterns/filtering)

Use checkboxes for multiple categorical values, searchable options for longer lists, and an explicit Any option for single-value fields. Multiple values within a category mean OR; separate categories mean AND. Keep chosen values visible after the menu closes. These choices follow PatternFly's enterprise filtering patterns. [PatternFly filters](https://www.patternfly.org/patterns/filters/design-guidelines/)

Dashboard-specific rules:

- Match the value actually reported in a column. AI context, manual outcomes and onboarding are independent criteria.
- Added to DB tests the stored flag; onboarded requires both the flag and a recorded WH reference. Do not silently substitute one for the other.
- Treat date ranges as inclusive calendar dates in IST. Reject reversed dates and area ranges before querying.
- WH ID matches one complete reference, including an ID inside a legacy comma-separated list. `261` does not match `1261`.
- “No calls logged” means no recorded manual events. It does not claim that no historical calls occurred.
- Reset the page when criteria change. Preserve repeated parameters on pagination, saved views, export and applicable bulk actions.
- Use the same server predicates for rows and totals. Always retain employee visibility restrictions.
- Keep controls labeled, maintain visible focus, fit panels to the viewport and retain reachable footer actions in both themes.

## Table coverage

| Surface | Filters available after this audit | Query / count behavior |
| --- | --- | --- |
| Assignments | Search, assignee, status; AI and manual result, Added to DB, WH ID, notes present, manual calls logged; channel, assigned by, city, follow-up, completion review; assigned dates and order | All criteria run before pagination. Status cards show the breakdown within other criteria and retain them on navigation. |
| Raw Dataset | Existing source, property, size and ownership controls; AI history result independently of latest AI result; manual result, Added to DB, WH ID, notes and manual activity; explicit has-phone / no-phone | The history filter uses Available > Unavailable > Unclear, matching the displayed badge. Rows, all-matching selection, queue, assignment preview and CSV share predicates. |
| Call Analytics | Existing outcome, connection, agent, direction, property, dates and ownership controls; Added to DB, WH ID, notes, manual activity, recording and transcript presence | Reporting uses the same visible assignment, with the existing legacy DB-field fallback for unassigned calls. Rows, count, IDs and CSV agree. |
| My Work — listings and AI follow-ups | Search, channel, manual result and follow-up; AI result, Added to DB, WH ID, notes, manual activity; city, assigned by, assigned dates and order | Both lists and status totals use the criteria within the signed-in caller's scope. AI filters and displayed AI context share a source. |
| AI / manual batch catalog | Search batch ID / creator / provider ID, status; creator or caller, language or origin; created dates and references | Repeated status choices survive pagination and CSV. Uses the shared filter panel, Apply and chips. |
| AI / manual batch members | Search contact / phone, result, call or assignment state, attempt presence, connected, city; original caller, current owner, onboarding and WH ID for manual batches | Member counts and CSV narrow together. Global progress cards remain whole-batch counts; selecting a card retains member filters. Clear filters retains the current card. |
| Team performance | IST dates and presets, caller, current or removed access | Summary and evidence scope use the same member/access criteria. Date presets retain roster criteria. |
| Team evidence | Target/evidence search, current task state, existing caller and metric drill-down | Pagination and CSV retain the complete evidence criteria. Clearing evidence criteria preserves the report context. |
| Access control | Name/email search, role and access status | Immediate filtering of the small loaded directory. Authorization checks and last-admin protections use the full directory, regardless of filters. These transient filters reset on reload. |

Other inspected surfaces: AI history already has contact/execution scope and provider-batch filtering. Record details, manual-call history and assignment/queue previews are scoped evidence or confirmation lists rather than global tables; they retain their existing scope and pagination without another filter toolbar. Loading tables mirror the corresponding page controls.

## Verification and screenshots

Verified on 13 October 2026:

- Production build and TypeScript checks passed.
- 112 unit tests and 57 targeted integration tests passed.
- 53 distinct Playwright tests passed across the filter, batch, team, design and navigation suites. The final shared-control refinements were followed by a passing 36-test run.
- The filter gallery contains 80 synthetic screenshots: 20 page/panel states at desktop and mobile sizes in both themes. Its manifest records exit code 0. Desktop and mobile captures were also inspected visually, including applied filters, draft changes and the panel footer.
- The development preview returned HTTP 200 on port 3000. No changes were pushed or deployed.

Backend regression coverage lives in `tests/integration/filters.test.ts`, `batches-wallet.test.ts` and `team-report.test.ts`. It exercises repeated categories, empty values, cross-channel AI context, whole-reference matching, legacy fallbacks, employee scope, IST boundaries and export/count parity.

`tests/browser/tests/39-filter-audit.spec.ts` exercises the new interactions and renders all affected pages and panels at 1366px and 390px in light and dark themes. It checks overflow, rendered contrast, applied chips, draft retention, category clearing, status-card navigation and export context. Existing filter, team, batch and loading suites also cover regressions.

The existing `bolna-eval/scripts/render-dashboard.mjs` wrapper accepts `--filters` to run this catalog through the application checkout. Use the disposable test database and the same environment documented in `DESIGN_SOP.md`, then add `--filters -g @render` to the render command. The output includes screenshots, manifests and a searchable `index.html` gallery. It uses synthetic fixtures and stubs provider requests.

From the application checkout, after `npm run test:stage -- build`:

```sh
EVAL_RENDER_DIR=../bolna-eval/shots/filter-audit npm run test:stage -- render-filters
```

This command supplies the existing isolated test configuration and creates the gallery in bolna-eval. It does not use the port 3000 preview or the live database.

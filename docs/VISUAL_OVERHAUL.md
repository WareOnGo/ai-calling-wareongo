# Dashboard visual and UX overhaul

Branch: `codex/bolna-visual-overhaul`, based on `8fb7597`. Implementation and preview are isolated in the `bolna-visual-overhaul` worktree, alongside the original app checkout. The preview is at `http://localhost:3000` using the existing local configuration.

## What changed

The supplied `DESIGN(1).md` establishes the visual direction: Inter, violet accents, restrained chartreuse primary actions, charcoal dark surfaces and rounded controls. Both themes remain available. Following review, light mode now uses white surfaces with very subtle violet grouping instead of broad grey fills.

The subsequent UX requests expand this beyond a theme swap. Routes, navigation and operational workflows remain, while the presentation changes:

- **Raw Dataset and Call Analytics:** useful default columns, horizontal row separators, short previews and compact pagination. Optional columns remain available through Columns. Spreadsheet freezing, draggable column widths, expandable column groups, row numbers and simulated spreadsheet cell navigation are removed. Native keyboard navigation and explicit copy actions remain.
- **Table reading order:** contacts and phone numbers lead. Raw property/location fields stay together; call evidence precedes the manual follow-up group. Assignments read contact → assignee/status → AI/manual results and notes → actions. Manual dispositions and due dates sit with the manual result. Queue review keeps name and phone adjacent; Team groups duration with call activity before outcomes. Batch members and My Work already follow the same identity/context/result/action progression. Headers, data cells and loading states share the new order, and optional-column choices remain intact.
- **Filters:** a focused side panel with named categories replaces the desktop wall of controls. Fields have consistent labels and boundaries. Values remain in the containing form across closed panels and hidden tabs; search, Apply, saved views and repeated-value filters retain their behavior.
- **AI history:** a timeline drawer replaces an expanded table row. Attempt time, direction, status and duration are readable first; provider identifiers and counting limitations remain available in disclosures. Dismissing the drawer restores focus and the list position.
- **Assignment dialog:** selection and caller choice lead into an eligibility summary. Optional reassignment/round-robin controls and inspection are closed initially. Inspection uses named record cards instead of a cramped multi-column table. Full ownership, completion and provider evidence remain accessible. A zero-eligible selection cannot submit an empty assignment batch.
- **Empty history:** zero-count AI/manual history buttons are omitted from record rows; result/count text and Details remain. A zero known AI count does not establish that no historical call ever happened. Legacy and incomplete evidence remain in Details.
- **Calling assignments:** shared typography, compact property facts, labeled mobile cards, clearer manual-result/latest-call grouping and reachable controls. Further restructuring of this screen is deferred at the user's request.
- **Other pages:** sign-in, overview, assignment management, AI/manual batches and detail pages, team reporting/access, loading states, forms and dialogs use the same tokens and controls.

The application's content and data remain accessible. Some labels are made more explicit, such as “Manual result” and “Latest manual call”. Long transcripts and diagnostics move out of the default overview. This is intentionally a presentation and interaction change, not an assertion of unchanged table geometry.

## Design system

[DESIGN_SOP.md](DESIGN_SOP.md) records the review procedure and its primary sources. It covers reading order, reusable components, spacing, contrast, density, responsive behavior and screenshot review.

`src/app/theme.css` owns the color, type, spacing and radius tokens. `globals.css` holds the base components; `tables.css`, `typography.css` and `workflows.css` cover records, readable type and focused interactions. All font loading is local: Inter v4.1 and its SIL Open Font License are included in `src/app/fonts/`.

Normal body text uses 14px at the default root size; supporting text is 13px and captions are 12px. Sizes use relative units. Changing density does not shrink body text. Field boundaries and focus indicators are checked separately from text contrast. Completed records retain readable text instead of a row-wide opacity reduction.

## Compatibility and behavior

New optional-column choices persist under `dashboard-hidden-v1:<path>`. Old spreadsheet widths, frozen columns and expanded groups are intentionally not migrated: carrying them forward would recreate the overcrowded view. This resets presentation preferences once, not application data or filters.

The allocation preview now fetches a display name with each record ID. Its eligibility logic, ownership protections, allocation hash and commit contract are unchanged. The autosave hook reconciles a refreshed revision in a layout effect so an immediate note edit after logging a manual call does not use the previous revision; a dirty draft retains conflict protection.

No migrations, authentication rules, provider dispatch rules or production data were changed for this visual work.

## Audit

Browser verification uses a production build, Chrome and a disposable PostgreSQL container with synthetic contacts. It runs at port 3131, independently of the local preview. The review checks include roles, filters, saved views, selection, export, ownership, assignment/reassignment, manual calls, AI evidence, batches, completion, autosave/error recovery and responsive controls.

The screenshot iterations found and corrected mobile overflow from positioned hidden descriptions, excessive balance/pagination height, conflicting modal width rules, inconsistent filter label/border geometry, a relative-font root-size issue, loading-header movement, clipped phone controls and narrow status badges. The added batch-member captures exposed phone numbers wrapping across several lines on mobile; readable minimum column widths now keep those tables scrollable within their own region. The representative 1366 × 768 raw-data capture shows six complete records in each theme; actual row counts depend on the viewport and data.

Validation completed on 12 October 2026:

| Check | Result |
| --- | --- |
| `npm run check` | Type checking and 112 unit tests passed |
| Production build (`next build --webpack`) | Passed, including type checking |
| Full browser suite after table reordering | 236 passed; 2 opt-in volume/performance scenarios skipped |
| Layout, assignment, contrast, record UX and render follow-up after phone/status sizing | 43 passed |
| Final render after the mobile batch-table correction | 4 passed; 100 captures (25 page/interaction states × 2 themes × 2 widths) |
| Local preview on port 3000 | Latest production build started; HTTP 200 |

Representative synthetic screenshots: [Raw light](visual-overhaul/raw-1366-light.png), [Raw dark](visual-overhaul/raw-1366-dark.png), [Calls](visual-overhaul/calls-1366-light.png), [Assignments light](visual-overhaul/assignments-1366-light.png), [Assignments dark](visual-overhaul/assignments-1366-dark.png), [mobile filters](visual-overhaul/filters-property-390-light.png), [assignment summary](visual-overhaul/assign-summary-1366-light.png), [AI history](visual-overhaul/ai-history-1366-dark.png), [mobile batch members](visual-overhaul/manual-batch-members-390-light.png).

Contrast checks cover the rendered elements selected by the tests and do not amount to full accessibility certification. Real Google OAuth and live provider calls are outside the synthetic suite. The two opt-in volume/performance scenarios are separate from its normal run.

## Repeatable screenshots

From the sibling `bolna-eval` directory, `npm run render:dashboard` delegates to this checkout's versioned renderer using `APP_DIR`. The command creates an HTML gallery with page/theme/width filters and a JSON manifest of captures. It includes every page type and the main filter, assignment, history, details, queue and manual-call interaction states, in both themes at 1366 × 768 and 390 × 844. Batch member tables and team access receive separate captures after scrolling, so content below the first viewport is covered too.

The canonical implementation is in `tests/browser/scripts/render-dashboard.mjs` and `tests/browser/tests/31-render-dashboard.spec.ts`. The sibling wrapper and npm script are installed in `bolna-eval`; this sibling folder is not itself a Git repository. See [browser setup and commands](../tests/browser/README.md) and the sibling harness README for the disposable-database settings.

For this review, the complete [100-capture gallery](../../bolna-eval/shots/visual-overhaul/index.html) is in the sibling eval directory. The manifest records actual viewport row/control counts to aid review. Selected synthetic screenshots are retained alongside this document.

## Local preview

```bash
node --env-file=../bolna-processing/.env.local node_modules/next/dist/bin/next start --port 3000
```

Run that from this worktree after building. The current preview has been started already. No changes have been pushed, merged or deployed.

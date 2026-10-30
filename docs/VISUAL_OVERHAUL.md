# Dashboard visual and UX overhaul

## Warehouse matching review — 30 October 2026

WH ID placement was subsequently checked in the actual tables. Assignments and
AI Calls now put every matched ID in their existing WH ID cell with a compact
source label. A different saved value remains labeled Saved; the phone matches
appear beneath it. My Work keeps the matches directly beneath its editable WH ID
field. Identical legacy references are no longer repeated in AI Calls.
No live data was changed in this visual follow-up. Type checking, the production
build and all nine focused production browser tests passed, including both
themes at 1366px/390px and 320px allocation dialogs. Inspected synthetic captures:
[WH ID column](visual-overhaul/warehouse-whid-column.png),
[My Work on mobile](visual-overhaul/warehouse-whid-my-work-390-dark.png),
[preserved saved ID](visual-overhaul/warehouse-whid-assignments-1366-light.png).

Caller and AI allocation dialogs exclude numbers linked to the imported WAG
warehouse snapshot and display every matching integer WHID. The shared notice is
also available in records, calls, assignments, My Work and batch history. The
Warehouse DB match filter has applied chips and preserves count/export scope.

The production build, type checking, 136 unit tests, all 379 integration tests and
five focused production-mode browser checks passed. Browser coverage includes
1366px light, 390px dark and 320px calling dialogs, rendered text contrast, viewport
overflow, exact CSV contents, filter interaction and preserved caller notes.
The 320px manual dialog and 390px dark AI dialog were inspected visually; their
action footers remain reachable and WHIDs wrap within the contact preview.
Synthetic captures: [manual 320px](visual-overhaul/warehouse-manual-320.png),
[AI 390px dark](visual-overhaul/warehouse-ai-390-dark.png).

The build required a retry after a security advisory notice. The production
dependency audit still flags Next.js and Zod; these package findings remain open
and are recorded in the [review report](warehouse-review-2026-10-30.json).
This feature review does not establish complete WCAG or security conformance.

Branch: `codex/bolna-visual-overhaul`, based on `8fb7597`. Implementation and preview are isolated in the `bolna-visual-overhaul` worktree, alongside the original app checkout. The preview is at `http://localhost:3000` using the existing local configuration.

## What changed

The supplied `DESIGN(1).md` establishes the visual direction: Inter, violet accents, restrained chartreuse primary actions, charcoal dark surfaces and rounded controls. Both themes remain available. Following review, light mode now uses white surfaces with very subtle violet grouping instead of broad grey fills.

The subsequent UX requests expand this beyond a theme swap. Existing report URLs and operational workflows remain, with dedicated routes added where tasks need separation:

- **Raw Dataset and AI Calls:** useful default columns, horizontal row separators, short previews and compact pagination. Optional columns remain available through Columns. Spreadsheet freezing, draggable column widths, expandable column groups, row numbers and simulated spreadsheet cell navigation are removed. Native keyboard navigation and explicit copy actions remain.
- **Call reporting:** manual notes, Added and WH ID display saved values as text, with clear empty states and retained legacy references. Long notes expand on demand. AI Calls no longer shows a save-status strip; My Work retains the editing workflow. Onboarding filters and CSV exports continue to use the same saved data.
- **Result colors:** Available uses green, Unavailable red and Unclear amber across record tables, assignments, batch members, Team evidence and details. Missing results remain neutral. My Work's result controls use the same palette. Raw Dataset's compact AI-attempt action combines a result label with outbound/inbound counts; its result uses Available → Unavailable → Unclear precedence across all saved results for the linked numbers, independently of the latest execution and the 20-record history preview. Balance-blocked records do not contribute.
- **Completed assignment attribution:** Raw Dataset and AI Calls retain the previous caller's name with “Assignment completed” when no assignment is active. Email remains the fallback for inactive or unnamed callers. A new active assignment takes precedence; this presentation does not change ownership or erase history.
- **Table reading order:** contacts and phone numbers lead. Raw property/location fields stay together; call evidence precedes the manual follow-up group. Assignments read contact → assignee/status → AI/manual results and notes → actions. Manual dispositions and due dates sit with the manual result. Queue review keeps name and phone adjacent; Team groups duration with call activity before outcomes. Batch members and My Work already follow the same identity/context/result/action progression. Headers, data cells and loading states share the new order, and optional-column choices remain intact.
- **Filters:** a focused side panel with named categories replaces the desktop wall of controls. Fields have consistent labels and boundaries. Values remain in the containing form across closed panels and hidden tabs; search, Apply, saved views and repeated-value filters retain their behavior. Views and Columns menus stay within the viewport, adjust on resize/scroll and keep long lists internally scrollable.
- **AI history:** a timeline drawer replaces an expanded table row. Attempt time, direction, status and duration are readable first; provider identifiers and counting limitations remain available in disclosures. Dismissing the drawer restores focus and the list position.
- **Assignment dialog:** One caller and Split across callers are visible choices in the main form. Split mode shows a checklist, current workloads and the new call count beside each selected person, with search for longer caller lists. The action says “Split X calls across Y callers” using the eligible task count. At least two callers are required for a split. Reassignment and detailed inspection remain separate options. Inspection uses named record cards instead of a cramped multi-column table. Full ownership, completion and provider evidence remain accessible. A zero-eligible selection cannot submit an empty assignment batch.
- **Record details:** contact information remains above Overview, AI activity and Manual activity tabs. Property facts and the latest AI call have separate sections; source listings sharing the phone retain their own property facts in an expandable group. AI history loads on first visiting its tab, and retains its state across tab switches. Notes, recording and transcript sit together; manual calls and verification history form separate groups. Arrow keys, Home/End and focus return support keyboard navigation. Numeric rents including decimal strings use readable Indian currency grouping.
- **Queue for calling:** one ready-to-call count and nonzero skip reasons replace the count chain and overlapping warning blocks. Language stays visible when it can affect eligibility. Previous outcomes, contact review, detailed accounting and balance metadata open on demand. Contact review shows name/phone/context beside one eligibility reason, with pagination for long selections. Empty batches offer Close and, when relevant, Recent batches. CSV export rechecks ownership; live calls retain an explicit confirmation that resets when language or outcome choices change. The action footer stays outside the scrollable content.
- **Empty history:** zero-count AI/manual history buttons are omitted from record rows; result/count text and Details remain. A zero known AI count does not establish that no historical call ever happened. Legacy and incomplete evidence remain in Details.
- **Calling assignments:** shared typography, compact property facts, labeled mobile cards, clearer manual-result/latest-call grouping and reachable controls. Further restructuring of this screen is deferred at the user's request.
- **Navigation and headers:** compact section links with an active underline; identity, view switching and sign-out live in an account menu. Page context and balance sit together. Raw/call toolbars group search, display choices and record actions. Pagination uses one centered Previous / Page / Next group.
- **Batches:** structured cards separate progress, dates and creator; detail pages group progress, outcomes and exceptions above the member list. Live page checks reconcile eligible batches with the provider while preserving drafts. Result counts alone never release queue reservations.
- **Team:** Performance remains at `/dashboard/team`, with date presets, summary metrics, aligned caller metrics and evidence. Access control moves to `/dashboard/team/access`, with member search and distinct role groups. Self-access and last-admin safeguards remain.
- **Loading:** Team and Batches have matching loading layouts. The inherited dashboard fallback follows the current route; delayed navigation to batch pages no longer renders the overview cards.
- **Other pages:** sign-in, overview, assignment management, AI/manual batches and detail pages, team reporting/access, loading states, forms and dialogs use the same tokens and controls.

The application's content and data remain accessible. Some labels are made more explicit, such as “Manual result” and “Latest manual call”. Long transcripts and diagnostics move out of the default overview. This is intentionally a presentation and interaction change, not an assertion of unchanged table geometry.

## Design system

[DESIGN_SOP.md](DESIGN_SOP.md) records the review procedure and its primary sources. It covers reading order, reusable components, spacing, contrast, density, responsive behavior and screenshot review.

`src/app/theme.css` owns the color, type, spacing and radius tokens. `globals.css` holds the base components; `tables.css`, `typography.css`, `workflows.css`, `queue.css`, `chrome.css`, `batches.css` and `team.css` cover records, readable type and focused interactions. All font loading is local: Inter v4.1 and its SIL Open Font License are included in `src/app/fonts/`.

Normal body text uses 14px at the default root size; supporting text is 13px and captions are 12px. Sizes use relative units. Changing density does not shrink body text. Field boundaries and focus indicators are checked separately from text contrast. Completed records retain readable text instead of a row-wide opacity reduction.

## Compatibility and behavior

New optional-column choices persist under `dashboard-hidden-v1:<path>`. Old spreadsheet widths, frozen columns and expanded groups are intentionally not migrated: carrying them forward would recreate the overcrowded view. This resets presentation preferences once, not application data or filters.

The allocation preview now fetches a display name with each record ID. Its eligibility logic, ownership protections, allocation hash and commit contract are unchanged. The autosave hook reconciles a refreshed revision in a layout effect so an immediate note edit after logging a manual call does not use the previous revision; a dirty draft retains conflict protection.

No migrations, authentication rules or provider dispatch rules changed. The batch-status follow-up also reconciles existing evidence and queue reservations through the normal provider checks; it does not place or cancel calls.

The previous reconciler only recognized the legacy provider state `executed`, while current Bolna snapshots report `completed` or `stopped`. It also treated three retries as mandatory even when automatic retries were disabled. The updated reconciler recognizes confirmed provider completion, verifies every target and execution, and retains the stricter retry checks for legacy snapshots. Large histories import in resumable chunks before reservations are released. Provider status contracts and retry documentation are linked in [the batch workflow documentation](../README.md).

The authorized local-data reconciliation on 13 October confirmed 14 completed batches and one provider-stopped batch, recorded locally as canceled. One batch still reports `running` at Bolna and remains reserved pending confirmation. No provider call or cancellation request was sent. A full result count is deliberately insufficient to override a running provider state.

## Audit

Browser verification uses a production build, Chrome and a disposable PostgreSQL container with synthetic contacts. It runs on a separate test port (3131 in the earlier audit, 3129 in the current regression run), independently of the local preview. The review checks include roles, filters, saved views, selection, export, ownership, assignment/reassignment, manual calls, AI evidence, batches, completion, autosave/error recovery and responsive controls.

The screenshot iterations found and corrected mobile overflow from positioned hidden descriptions, excessive balance/pagination height, conflicting modal width rules, inconsistent filter label/border geometry, a relative-font root-size issue, loading-header movement, clipped phone controls and narrow status badges. The added batch-member captures exposed phone numbers wrapping across several lines on mobile; readable minimum column widths now keep those tables scrollable within their own region. The representative 1366 × 768 raw-data capture shows six complete records in each theme; actual row counts depend on the viewport and data.

Validation completed on 12 October 2026:

| Check | Result |
| --- | --- |
| `npm run check` | Type checking and 112 unit tests passed |
| Production build (`next build --webpack`) | Passed, including type checking |
| Full browser suite after table reordering | 236 passed; 2 opt-in volume/performance scenarios skipped |
| Layout, assignment, contrast, record UX and render follow-up after phone/status sizing | 43 passed |
| Final render after the mobile batch-table correction | 4 passed; 100 captures (25 page/interaction states × 2 themes × 2 widths) |
| Local preview on port 3000 | Initially production; now the live development server with hot reload |

Calling-preview follow-up completed on 13 October 2026:

| Check | Result |
| --- | --- |
| Final production build, including type checking | Passed |
| Workflow, ownership, CSV, wallet, theme and gallery regressions | 56 passed |
| Final focused queue checks after retaining completed ownership details | 8 passed |
| Expanded visual gallery | 116 captures (29 states × 2 themes × 2 widths) |
| Live development preview | Port 3000, hot reload, isolated `.next-preview` output |

Desktop/mobile queue screenshots were inspected in both themes. Checks cover empty batches, queued contacts, eligibility changes, explicit confirmation, scroll containment, contact pagination, completed ownership metadata and balance refresh. Representative follow-up images: [queue summary](visual-overhaul/queue-ready-1366-light.png), [mobile dark summary](visual-overhaul/queue-ready-390-dark.png), [contact review](visual-overhaul/queue-contacts-1366-dark.png).

Caller selection, record details and menu placement follow-up completed on 13 October 2026:

| Check | Result |
| --- | --- |
| Unit tests | 112 passed |
| Final production build, including type checking | Passed |
| Assignment, ownership, recovery, details, theme, menu and gallery regressions | 76 passed |
| Expanded visual gallery | 136 captures (34 states × 2 themes × 2 widths) |
| Live development preview | Port 3000 remains available with hot reload |

The final desktop/mobile screenshots were inspected in both themes. Tests cover selecting multiple callers, exact per-caller allocations, the two-caller minimum, preserving selections while searching, switching back to one caller, the existing assignment commit contract, keyboard tab navigation, lazy AI history, retained panel state, manual-history pagination and formatted rents. Views and Columns are checked for viewport containment and actual pointer reachability across Raw Dataset, AI Calls, Assignments and My Work. Screenshot review also removed redundant picker borders and corrected date wrapping on mobile.

Representative follow-up images: [split calls](visual-overhaul/assign-split-1366-light.png), [mobile dark caller picker](visual-overhaul/assign-split-390-dark.png), [details overview](visual-overhaul/record-details-1366-light.png), [mobile dark details](visual-overhaul/record-details-390-dark.png), [Views at the page edge](visual-overhaul/saved-views-1366-light.png).

Navigation, Team, batch lifecycle and reporting follow-up on 13 October 2026:

| Check | Result |
| --- | --- |
| Unit tests | 112 passed |
| Batch reconciliation and reliability integration tests | 49 passed |
| Team reporting integration tests | 22 passed |
| AI history and filter integration tests | 41 passed |
| Final production build, including type checking | Passed |
| Full browser audit | 275 passed; 2 opt-in volume checks skipped; 6 fixture/selector failures corrected below |
| Final loading, attribution, history colors, reporting and record UX follow-up | 43 passed, including all six corrected cases |
| Final screenshot renderer | 4 passed; 144 captures (36 states × 2 themes × 2 widths) |
| Live development preview | Port 3000, verified HTTP 200, isolated `.next-preview` output |

The full run exercised all 281 standard browser scenarios. Its six failures came from a completion fixture missing a required manual-call event, a loading selector matching React's hidden staging copy, and four theme/width cases matching both an optional AI badge and the manual badge. The final follow-up uses a valid recorded call, measures the visible loading UI and targets the manual-result column explicitly. Screenshot inspection also found a clipped AI Calls history button; its label now wraps within the column, with a geometry assertion covering both widths and themes.

Completed caller attribution is checked on both record grids, after access removal and after reassignment. Result tests cover older Available evidence beyond the 20-row history preview, inbound calls, alternate numbers, balance-blocked exclusions, empty history, dialog focus return and the same palette in reporting badges and My Work controls. Read-only AI Calls retains saved notes, onboarding filters and CSV values. The final screenshots retain six complete Raw Dataset rows at 1366 × 768.

Final screenshots inspected in both themes and widths include [result colors and attribution](visual-overhaul/ai-attempt-colors-1366-light.png), [dark result colors](visual-overhaul/ai-attempt-colors-1366-dark.png), [mobile manual results](visual-overhaul/manual-result-colors-390-dark.png), [Team performance](visual-overhaul/team-1366-dark.png), [Access control](visual-overhaul/team-access-1366-light.png), [batch details](visual-overhaul/ai-batch-1366-light.png) and [the account menu](visual-overhaul/account-menu-1366-light.png). The full gallery's final manifest records a successful run.

Representative synthetic screenshots: [Raw light](visual-overhaul/raw-1366-light.png), [Raw dark](visual-overhaul/raw-1366-dark.png), [Calls](visual-overhaul/calls-1366-light.png), [Assignments light](visual-overhaul/assignments-1366-light.png), [Assignments dark](visual-overhaul/assignments-1366-dark.png), [mobile filters](visual-overhaul/filters-property-390-light.png), [assignment summary](visual-overhaul/assign-summary-1366-light.png), [AI history](visual-overhaul/ai-history-1366-dark.png), [mobile batch members](visual-overhaul/manual-batch-members-390-light.png).

Contrast checks cover the rendered elements selected by the tests and do not amount to full accessibility certification. Real Google OAuth and live provider calls are outside the synthetic suite. The two opt-in volume/performance scenarios are separate from its normal run.

## Spacing and hierarchy audit — 14 October 2026

Shared gutters now align headers, tools, summaries and inset lists (24px desktop, 16px mobile). Dialogs use the same inset for their heading, content and actions. Real page H1s and dialog H2s replace generic title containers; the brand no longer competes as the page heading. Report guidance and autosave explanations use named disclosures. Save feedback stays visible outside document flow without moving the worklist.

Batch summaries distinguish three primary progress metrics from compact outcome and exception rows, retaining every filter. Nested access-control toolbars no longer double their padding. Short batch tables no longer reserve empty space. Home card actions align, and badges size to their content. My Work fits at 1024px after removing an excessive table minimum width. Loading screens preserve the final layout on desktop and mobile.

| Validation | Result |
| --- | --- |
| Type checking and unit tests | 117 unit tests passed |
| Production build | Passed |
| Full browser suite | 315 passed; 2 opt-in volume tests skipped; 10 failures investigated |
| Final visual/loading/recovery follow-up | 30 passed |
| Final desktop filter audit | 2 passed |
| Final gallery | 164 captures, successful manifest |

The full run exposed medium-width My Work overflow and 4px of excess assignment header height. The remaining failures were stale selectors for current filter categories, the shared Details history, saved transcript disclosure, or updated empty-state copy. All ten cases pass after correction; the follow-up also verifies save feedback does not shift the toolbar, keyboard dismissal, and loading geometry. The final screenshots were inspected in both themes. At 1366 × 768, Raw Dataset retains six complete rows, AI Calls increases from four to five, and My Work from one to two in the representative fixture. These are fixture-specific viewport counts, not fixed row-height promises.

Review the [before gallery](../../bolna-eval/shots/spacing-before/index.html), [final gallery](../../bolna-eval/shots/spacing-final/index.html), and [spacing rules and references](DESIGN_SOP.md#3-use-whitespace-to-group-information).

## Repeatable screenshots

From the sibling `bolna-eval` directory, `npm run render:dashboard` delegates to this checkout's versioned renderer using `APP_DIR`. The command creates an HTML gallery with page/theme/width filters and a JSON manifest of captures. It includes every page type and the main filter, assignment, history, details, queue and manual-call interaction states, in both themes at 1366 × 768 and 390 × 844. Batch member tables receive separate captures after scrolling. Team Performance, Access control and the add-member form each have their own captures.

The canonical implementation is in `tests/browser/scripts/render-dashboard.mjs` and `tests/browser/tests/31-render-dashboard.spec.ts`. The sibling wrapper and npm script are installed in `bolna-eval`; this sibling folder is not itself a Git repository. See [browser setup and commands](../tests/browser/README.md) and the sibling harness README for the disposable-database settings.

For this review, the complete [visual gallery](../../bolna-eval/shots/visual-overhaul/index.html) is in the sibling eval directory. The queue follow-up adds four states per theme/width: the eligible summary, outcome choices, contact review and final confirmation. The latest follow-up adds caller splitting, saved views and the details panel's source listings, AI activity and manual activity. The manifest records actual viewport row/control counts to aid review. Selected synthetic screenshots are retained alongside this document.

## Local preview

```bash
npm run dev:preview -- ../bolna-processing/.env.local
```

Run that from this worktree with Node 22. The launcher loads the selected environment file before spawning Next, preserving authentication configuration; it defaults to `.env.local` when no file argument is supplied. The current preview is already running with hot reload on port 3000, using the original checkout's local configuration. The `.next-preview` directory keeps it independent of production builds in `.next` used by the browser harness on port 3129. No changes have been pushed, merged or deployed.

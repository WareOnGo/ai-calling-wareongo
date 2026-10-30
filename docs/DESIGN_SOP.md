# Dashboard design and review SOP

Apply this procedure to every dashboard page, panel and interaction. The visual direction comes from the supplied `DESIGN(1).md`; the rules below adapt it to daily work with large record sets. These are product-specific decisions informed by the linked guidance, not a claim of complete WCAG conformance.

## 1. Define the reading order

Identify the page's main task and the information needed to perform it. Use this order: page title and status, search and primary controls, results, pagination. Keep long evidence, identifiers and explanations available in Details or an explicitly named disclosure. A modal starts with the decision and its consequences; detailed accounting follows on request.

Carbon recommends a dedicated page or side panel when expanded table content becomes cramped. Here, AI history uses a drawer so a user's record list keeps its position. Default columns support scanning; optional columns remain available through Columns. [Carbon data tables](https://www.carbondesignsystem.com/building-blocks/core/components/data-table/guidelines)

Within a row, identify the subject first. Use the shared `ContactCard` in a single Contact column: name above the phone and copy action, followed by quiet context where needed. Give it a subtle border, compact padding and an opening chevron. Size it to its contents within the column, capped at 240px; truncate long names to one line and retain the full name in the title and Details. The entire card opens Details; there is no separate Details chip. Keep the native opening button and copy button as independent controls, with visible keyboard focus and focus restored after closing Details. Missing numbers show “No phone number” without a copy action. Keep related fields next to one another. Do not make someone cross the row repeatedly to connect a result, its notes and the responsible person. Use real DOM order so keyboard navigation, assistive technology, loading states and visible headers agree.

| Table | Reading flow |
| --- | --- |
| Raw Dataset | Contact → location and property → AI activity → assigned caller and manual result/history |
| AI Calls | Contact → AI result and evidence → assigned caller, manual result and notes → onboarding |
| Assignments | Contact → assignee and status → AI/manual results and follow-up notes → actions |
| My Work | Contact and property → AI context → manual result and notes → onboarding and completion |
| Batch members | Contact and location → ownership → state, result and attempts |
| Queue review | Ready count and skipped reasons → language → optional contact/outcome review → explicit confirmation |
| Team metrics | Caller → attempts, connection and duration → availability and onboarding |

Optional columns stay next to their related default columns. Keep exact identifiers and legacy metadata secondary. Column visibility preferences are keyed by label and survive a change in reading order. Contact remains visible; migrate Raw Dataset’s former Contact classification preference to Contact type. Skeletons use the same contact card geometry.

Reporting tables show values as text. In AI Calls, manual notes, Added and WH ID must not render inputs or checkboxes, including disabled ones. Use explicit empty states, preserve legacy labels and keep long notes readable on demand. Editing and save feedback belong in My Work.

Warehouse phone matches belong in the existing WH ID column wherever one exists.
Show the IDs as ordinary values with a compact source annotation. Preserve a
different saved ID and label the phone matches separately within that same cell.
In My Work, keep matches beneath the editable WH ID field; never select an
arbitrary warehouse when a number matches several. Avoid repeating the same ID
under the contact or duplicating identical legacy references.

Keep attribution after an assignment is completed. When there is no active assignment, show the last completed assignment's caller with “Assignment completed” beneath the name. A new active assignment takes precedence. Keep an email fallback when the caller no longer has access; removing access must not erase their attribution.

In Assignments, use a compact assignee card with the name and a quieter “Assigned by X on 15 Oct 26” line. Omit email addresses from the card; use the account handle when a display name is unavailable. Place the completion date under Done using IST, with “Date not recorded” when no timestamp exists. Clicking the card opens the recorded assignment batch in a modal with its brief, progress and member list; keep full batch filters on the linked batch page. Older assignments without a batch show only their own details. Never infer shared batch membership from timestamps. Closing the modal preserves the table's filters and focus.

For calling previews, show a single eligible count and only nonzero skip reasons. Put per-contact evidence, duplicate counts, routing explanations and balance timestamps behind named disclosures. Contact inspection keeps names and phones together, with one eligibility reason per contact. An empty batch offers a clear next step and Close; a nonempty batch retains an explicit confirmation before placing calls. Changing outcomes or language resets that confirmation. Keep the footer outside the scrollable review content.

For human assignments, offer One caller and Split across callers beside the caller controls. Split mode shows an explicit checklist, each selected caller's share and a confirmation such as “Split 90 calls across 3 callers”. Use eligible tasks after the ownership and duplicate checks for the call count. Require at least two selected callers for a split, preserve selections while searching, and keep reassignment as a separate option.

Record details keep the contact's name, phone and call action visible above Overview, AI activity and Manual activity tabs. Group property facts and the latest AI call separately in Overview; keep linked source listings distinct because the same phone can refer to different properties. Load AI history when its tab is visited. Keep recordings, transcripts, manual corrections and verification history accessible in their named sections.

Render transcripts as chat turns: AI agent on the left in a soft accent bubble, Caller on the right with a neutral outlined bubble. Keep explicit speaker labels, original wording, line breaks and message order. Use body-sized text and generous line height for mixed Hindi and English. Preserve unlabelled text without assigning it to a speaker. Use the same transcript component for individual calls and older saved evidence.

Use the shared AI attempt card in Raw Dataset, AI Calls and Assignments. It opens this same Details panel directly to AI activity; the ordinary contact card opens Overview. Keep static identity in the drawer header, followed by a call count and a chronological timeline, newest first. Avoid a second saved-summary card, metric grid and explanatory paragraphs above the calls. Keep batch and execution filters, counting definitions and older saved evidence behind History options. The timeline starts on the displayed phone; show a phone selector only when multiple linked numbers exist, with one option per normalized number and an All linked numbers option. Admins can see all calls for the number; employees assigned an execution remain restricted to it. Table cards still summarize the listing's linked numbers or the row's execution; label any execution restriction explicitly in the timeline.

Deduplicate provider calls by normalized phone and provider call ID before counting, pagination and intervals. Repeat calls remain separate; missing phone identities must not merge unrelated executions. Use flat timeline entries with the result and time first, then direction, duration and known agent language. Show a brief note and the recording player directly, without preloading audio. Keep Transcript one click away and provider identifiers, connection evidence and intervals inside Call info. Do not apply the latest execution's enrichment to older provider calls. Preserve older saved notes/media under Saved record details when their provider identity is unavailable, with a direct link from an empty timeline. Cards use the shared result colors and Available → Unavailable → Unclear precedence. Zero recorded attempts show a quiet count without a button; a known attempt with missing direction remains available and is labeled explicitly. Preserve list position, filters and keyboard focus when closing the panel.

Keep global navigation compact, with the current section underlined. Group identity, view switching and sign-out in the account menu, while leaving the theme toggle visible. Page headers contain the title, related page tabs, context and freshness. Raw/call toolbars group search and filters, display preferences, then record actions. Keep pagination centered as a single Previous / Page / Next group; preserve filters when changing pages.

Team Performance and Access control are separate routes with shared navigation. Reporting follows date range → summary → caller metrics → optional evidence. Keep numeric columns aligned, duration coverage explicit, historical limitations readable and full definitions available on demand. Access control follows sign-in explanation → member search → role groups. Preserve self-access and last-admin protections.

Batch cards show identity and status, contact progress, labeled dates/creator and the next action. Detail pages group progress, outcomes and exceptions above the member list. A full progress bar is not proof that retries have finished: use the provider's confirmed lifecycle state before labeling a batch Completed or releasing its reservations. Provider-stopped work remains distinct from completed work.

## 2. Use shared components and tokens

- Use `theme.css` for semantic colors, spacing, radii and font sizes. Add a role to the shared system before adding a one-off color.
- Use Inter and the existing scale: 12px captions, 13px supporting text, 14px body/controls, 16px sections, 20px titles and 24px metrics at the default root size. The tokens use `rem` so user text settings can scale them.
- Keep primary actions chartreuse, navigation/secondary emphasis violet, destructive actions red, and result colors semantic. Always show the result in words too.
- Use the same `RecordsHeader`, `RecordsPagination`, `Dialog`, `FilterPanel`, `MultiSelect`, `RecordDetails`, `PageJump`, save feedback and column chooser across pages. Position the primary dialog action at the end of its footer.
- Separate AI results, manual results, the latest manual attempt and task completion by explicit labels. A recorded call and a note edit are different events.

Use the shared result badges everywhere: Available is green, Unavailable is red, and Unclear is amber in both themes. Missing results remain neutral. My Work's editable result controls use the same semantic colors. Always retain a written result, so color is not the only signal. Raw Dataset's AI-attempt summary uses Available → Unavailable → Unclear precedence across all saved, non-balance-blocked AI results for the listing's linked numbers. Keep that summary distinct from the most recent execution result and retain separate outbound/inbound counts. A zero known-attempt count has no history action.

The principle of reusing tested typography styles is drawn from [GOV.UK's type scale](https://design-system.service.gov.uk/styles/type-scale/); the sizes above are our dashboard choices, not GOV.UK's scale.

## 3. Use whitespace to group information

Use the shared 4/8/12/16/20/24/32px spacing scale. Prefer 8px within a small control group, 12–16px within cards, and 20–24px between sections. Align labels and their fields; put minimum and maximum ranges beside each other. Use a larger gap between unrelated groups than between related controls.

Use `--page-gutter` (24px desktop, 16px mobile) for page headings, toolbars, result summaries and inset lists. Nested toolbars must not add a second horizontal gutter. Use `--panel-inset` (20px desktop, 16px mobile) for dialog headers, bodies and footers. Keep table cell spacing separate from outer page gutters. This adapts [Carbon's spacing scale and alignment rules](https://www.carbondesignsystem.com/building-blocks/foundations/spacing/overview) to the dashboard.

Give each page a real, clearly styled H1 and dialogs an H2. The application brand is not the page heading. Keep secondary report descriptions at supporting size and weight. Show the balance chip beside the page title when space permits, rather than reserving another full-width row.

Avoid repeated instruction bars: AI Calls keeps review status and a named report explanation beside its title. My Work keeps autosave guidance near the result summary; idle save feedback remains available to screen readers, while unsaved changes, saving and failures remain visible in a tray outside document flow so they do not move the worklist. Do not repeat the selected filter category as another visible heading. Keep all explanatory content reachable through a named disclosure.

In batch summaries, emphasize the three progress metrics and use compact labeled rows for outcomes and exceptions. Keep every metric selectable, including zero counts, because these are report filters. Do not give all counters equal visual weight or let a fourth secondary counter force large blank areas across the page. On small screens, progress spans the width and the two secondary groups sit beneath it.

Keep compact action targets at least 24px or provide the spacing permitted by the [WCAG 2.2 target-size criterion](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum). Dialog close buttons use 32px targets. Do not reduce interactive targets to increase row density. Remove unused minimum heights from short content tables; reserve flexible table space only for the main record grids that need a stable scrolling region.

Reserve whitespace for reading and grouping. Avoid full-width prose, oversized empty fields or a second pagination row when the controls fit on one line. Use quiet horizontal record separators and modest card boundaries. Default record rows show short previews; Details retains the full content.

Using a repeatable spacing scale and reviewing vertical rhythm follows [GOV.UK's spacing guidance](https://design-system.service.gov.uk/styles/spacing/). The particular 4px scale is an implementation choice for this dashboard.

## 4. Check contrast in the rendered interface

Normal text needs at least 4.5:1 contrast against its actual background. Check supporting text, placeholders, selected states, hover and both themes. Use at least 3:1 for essential control boundaries and visual state indicators. Decorative separators can remain quieter. Do not use opacity to fade an entire completed task; its contents still need to be read and edited. [W3C text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [W3C non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)

Keep a visible keyboard focus ring. Dialogs must retain reachable close/save controls, contain focus, and restore focus on dismissal. Escape first closes an open filter choice, then the containing panel. Buttons and inputs retain readable labels on narrow screens.

Toolbar menus must fit inside the viewport even when their trigger is against an edge or wraps to another line. Check both bounds and hit testing: an ancestor can clip a menu whose own width looks correct. Views and Columns recalculate their position on opening, scrolling and resizing, and use internal scrolling when vertical room is limited.

## 5. Review density and responsive behavior

- At 1366 × 768, inspect the actual number of complete records visible. The representative Raw Dataset fixture must show at least six. Counts vary with the content and viewport; do not force a fixed row height that clips controls.
- Primary raw/call/assignment columns must fit a 1366px laptop without horizontal panning. Optional wide evidence tables may scroll inside their own region.
- At 390px, and at 320px for calling forms, check every control. My Work becomes labeled cards and the page scrolls naturally. Panels fit the viewport with their action footer reachable.
- Verify long names, multiple cities, empty results, busy/save/error states, and populated history. Compare loading and loaded page geometry.
- Give each route its own loading state. The inherited dashboard fallback must follow the destination route; never flash the home cards when opening a record list, Team or Batches. Check slow client navigation as well as initial page loads.

## 6. Run, inspect, fix, repeat

1. Run type checking and the appropriate unit/browser checks for behavior changes.
2. Run `npm run render:dashboard` from `bolna-eval`, pointing `APP_DIR` at this checkout and using the disposable eval database. See [browser harness setup](../tests/browser/README.md).
3. Open the generated `index.html`. Review every page type and the filter, assignment, history, detail, queue and manual-call captures in both themes and widths. The JSON manifest records routes, viewports, visible row counts and control counts; counts are review aids, not universal usability scores.
4. Check hierarchy, label alignment, spacing, contrast, truncation, clipping and competing actions. Open individual screenshots at full size.
5. Fix shared causes in tokens/components first. Rebuild and rerun affected checks after a change. Run the full browser suite before concluding a broad overhaul.
6. Record actual results and remaining limits in [the visual audit](VISUAL_OVERHAUL.md). Preserve representative synthetic screenshots. Never use production contacts in committed audit images.

The automated coverage includes rendered text contrast (`29` and the catalog), loading geometry (`12`, `14`), controls/density (`30`, `31`), field/focus contrast and filter continuity (`32`), calling-preview eligibility, confirmation, contact pagination and balance recovery (`33`), multiple-caller selection, detail tabs and menu clipping (`34`), centered pagination and live batch updates (`35`), separate Team pages and member search (`36`), and slow navigation without home-screen flashes (`37`). Human screenshot review remains required; automated checks do not establish that a workflow is easy to understand.

## 7. Keep filtering consistent

Use the [filter audit and interaction rules](FILTER_AUDIT.md) when adding a column or a reporting surface. A filter must use the same field semantics as its column, retain access scope, and work before counting, pagination, export and bulk selection. Test Any, a specific value and an empty result. Keep all criteria except free-text search in the shared Filters panel, show the applied state outside it, and verify both themes and mobile screenshots with `39-filter-audit.spec.ts` (`render-dashboard.mjs --filters -g @render`).

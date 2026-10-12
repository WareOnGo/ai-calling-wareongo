# Dashboard browser tests

This version-controlled Playwright harness drives the real app with deterministic synthetic PostgreSQL fixtures and signed test sessions. It includes its own dependency lockfile; generated screenshots, traces, reports and dependencies are ignored.

From the app root:

```bash
npm ci
npm ci --prefix tests/browser
cd tests/browser
npx playwright install chromium
EVAL_CONTAINER=bolna-fixes-pg PGPORT=55439 EVAL_DB_URL=postgres://postgres:bolna-fixes-test-only@127.0.0.1:55439/postgres npm run db:up
cd ../..
npm run test:stage -- build
npm run test:stage -- browser-production
```

For the `test:stage` wrapper, start the database using `EVAL_CONTAINER=bolna-fixes-pg PGPORT=55439 EVAL_DB_URL=postgres://postgres:bolna-fixes-test-only@127.0.0.1:55439/postgres` with the `db:up` command. Podman is required by fixture helpers. The wrapper uses port 3129 and fake provider credentials; it never takes a database URL from `.env.local`. A compatible local Chrome path can be supplied through `EVAL_CHROMIUM_PATH`; otherwise use installed Chromium.

Run one DB-mutating suite at a time. Ordinary browser tests reseed before each test. The two volume scenarios run separately after `npm run test:stage -- performance review`, with `npm run test:stage -- browser-volume-production`, and intentionally preserve that fixture.

On a machine with limited root-disk space, set `EVAL_DATA_DIR` to a dedicated
absolute fixture directory when starting `db:up`; the harness bind-mounts it as
the disposable PostgreSQL data directory. A directory under `/tmp` is ephemeral.

Provider dispatch responses, wallet reads and failure paths are mocked. Nothing here establishes that live calls, OAuth setup or production migrations are ready. `npm run report --prefix tests/browser` opens the generated HTML report.

## Visual design audit

Run `npm run render:dashboard` from this directory with the same environment
settings as the browser suite. The command runs `31-render-dashboard.spec.ts` and
prints a searchable HTML gallery plus a JSON manifest under `shots/dashboard-*`.
`EVAL_RENDER_DIR` selects a fixed output directory. It covers every page type and
filter, assignment, history, details, queue and manual-call states at desktop and
mobile widths in both themes. Only synthetic eval data appears in the images.
The queue captures include no eligible contacts, a ready summary, outcome
choices, contact inspection and the final confirmation. `33-queue-ux.spec.ts`
also checks queued-only selections, language/outcome changes, a paginated
contact review, completed ownership details and compact balance recovery.
`34-assignment-details-menus.spec.ts` checks multiple-caller selection and
allocation counts, detail tabs and history pagination, and actual hit testing
of Views/Columns menus at the viewport edges. The gallery includes each new
detail section and the split-caller and saved-view states in both themes.

`35-pagination-batches.spec.ts` covers centered pagination, preserved repeated
filters, grouped batch details and live completion updates. `36-team-pages.spec.ts`
checks the separate Performance/Access control routes, member search and route
permissions. `37-navigation-loading.spec.ts` holds database reads while navigating
to Batches and its details, and watches rendered frames for unwanted home cards.
The gallery includes the account menu and both Team pages, plus the add-member
form. Provider sync requests are stubbed in browser contexts; completion,
stopped batches, retries, incomplete snapshots and reservation release are tested
against fake provider responses in `tests/integration/batch-live.test.ts`.

`13-assignment-view.spec.ts` checks completed-assignment attribution, inactive
caller fallback and replacement by a new active owner. `20-handoff-ai.spec.ts`
checks the shared result palette, AI summary precedence, empty history actions,
focus return and contrast at both widths in both themes. `26-review-regressions.spec.ts`
verifies that My Work changes appear as read-only Call Analytics values, retaining
the same onboarding filters and export data.

The sibling `bolna-eval` harness also provides `npm run render:dashboard`; its
wrapper uses `APP_DIR` to run this checkout's scenarios. Thus the renderer stays
versioned with the implementation it checks. The wrapper defaults to the
`bolna-visual-overhaul` worktree for this review.

Review the actual images as well as the checks. Use
[the design SOP](../../docs/DESIGN_SOP.md) for consistency, contrast, whitespace,
density and interaction review. A gallery's visible-control count is a useful
inspection aid, not an automated usability score.

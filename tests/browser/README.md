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

The sibling `bolna-eval` harness also provides `npm run render:dashboard`; its
wrapper uses `APP_DIR` to run this checkout's scenarios. Thus the renderer stays
versioned with the implementation it checks. The wrapper defaults to the
`bolna-visual-overhaul` worktree for this review.

Review the actual images as well as the checks. Use
[the design SOP](../../docs/DESIGN_SOP.md) for consistency, contrast, whitespace,
density and interaction review. A gallery's visible-control count is a useful
inspection aid, not an automated usability score.

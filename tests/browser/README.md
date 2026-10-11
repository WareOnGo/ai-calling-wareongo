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

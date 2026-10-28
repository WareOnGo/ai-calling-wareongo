# Contact ownership browser regressions

Run `npm run build`, then `TEST_DATABASE_URL=<disposable-local-postgres-url> npm run test:browser` from the repository root. Install Chromium once with `npx playwright install chromium`, or supply `BROWSER_CHROMIUM_PATH` for a local installation.

The six tests own a production Next.js server on port 3137 (`BROWSER_PORT` overrides it), use synthetic callers and signed test sessions, reset fixture tables, and block external browser requests. They cover both Unassigned grids and CSVs, duplicate selection summaries, cross-channel reassignment, all-matching allocation, the existing Done workflow/navigation, and simultaneous API requests. Do not run integration and browser suites concurrently against the same database.

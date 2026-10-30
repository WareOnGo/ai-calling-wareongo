# Loading audit — 14 October 2026

The audit found avoidable database work, duplicate balance requests and task reads that fetched evidence the screen did not use. These are fixed in the local app. Production-mode browser tests are faster than the development preview, but live database timings remain variable. This is not a claim that every live page is now consistently fast.

## Changes

| Finding | Change |
| --- | --- |
| Assignment counts and pagination resolved display phones/results across all matching assignments | Counts include only joins required by filters. The page is selected before display enrichment; the volume query plan verifies only 50 assignments receive those lookups. |
| AI Calls selected IDs through a reporting view with unnecessary per-call assignment lookups | Counts, export counts and bulk IDs read a lightweight projection with the same availability/filter/scope rules. Full display details load for the selected page. |
| My Work fetched full records, metadata, transcripts and histories after reading assignments | A small property-context projection replaces the second evidence fetch. Two queries per worklist instead of three. The regression fixture includes very large unused notes/transcripts and verifies database response bytes remain below 5 KB. |
| Opening Details fetched manual events and assignment history immediately; manual pagination fetched the entire record again | Overview and Manual activity have separate reads. Manual history loads on first use, and visited pages are reused for that open drawer. Independent reads run together. Manual-history entry buttons open the correct tab. |
| AI history made five sequential reads, including an empty row query | Shared authorization/contact lookup and combined totals reduce this to three reads with history, two when empty. Permissions, phone grouping, deduplication and exact-call evidence are preserved. |
| Each balance component mounted its own request; development replay doubled it | A dashboard-scoped cache shares in-flight requests and data for 60 seconds. Explicit refresh updates the header and calling dialog together. It resets with the signed-in user/view. |
| Raw Dataset fetched the entire queue membership set for unused HTML attributes | Removed the initial queue read. Opening and confirming a calling preview still fetch and validate the selected contacts. |
| Filter option readers waited for four/three sequential queries | Each reader now uses one query, retaining the existing ten-minute cache and option semantics. |
| Batch lists made a separate legacy-count query and immediately refreshed completed/manual pages | Legacy count shares the existing totals query. Only active AI batches need the initial status check; the regular 30-second refresh remains. |
| Default Raw ordering sorted every source record | Migration **009** adds matching Raw and Assignment pagination indexes, built concurrently. Tested on the disposable database; pending on the shared database. |

## Measured results

The isolated fixture contains 50,000 records, 10,000 calls with approximately 3 KB transcripts, 5,000 assignments/manual events and 2,000 identified AI attempts. These are medians of five sequential application-reader measurements on local PostgreSQL, including round trips. The final run had no concurrent build.

| Reader | Before | After |
| --- | ---: | ---: |
| Raw first page | 18 ms | 13 ms |
| Raw page 400 | 63 ms | 17 ms |
| AI Calls first page | 42 ms | 15 ms |
| Assignments page 50 | 118 ms | 8 ms |
| My Work | 28 ms | 10 ms |

All 19 workloads passed. Broad fuzzy searches still take roughly 0.5–0.7 seconds on this fixture; the audit does not promise constant-time searches. Index-plan assertions verify the Raw pagination index is used and assignment display work is bounded to the page.

Production browser checks passed on the volume fixture, including repeated pages at 1.5 Mbps. Warm AI Calls readiness moved from 495–510 ms to 411–432 ms; Assignments page 50 moved from 592–596 ms to 475–481 ms. Warm Raw first-page results were essentially unchanged at 508–565 ms, demonstrating that database speedups do not translate directly into identical browser gains.

The same machine also read the live database through local development and production servers. In the final production sample, opening Details took 329 ms for the sampled record and 252 ms for the sampled call, compared with 843 ms and 1,173 ms before. Opening their empty AI histories took about 304–307 ms versus 728–760 ms before. These are individual observations, not percentiles.

Live query plans confirm structural reductions independent of timing noise: the default assignment count's shared-buffer hits fell from 16,983 to 45, its page from 23,292 to 663, and AI Calls ID selection from 19,824 to 2,734. Raw still scans 58,821 records on the shared database because migration 009 is not applied there.

The development Raw/Batches balance request count fell from two to one per full load. A browser regression separately verifies client navigation and opening the calling dialog reuse that balance, while explicit refresh performs one new read.

## Remaining limits and deployment

- **Live cold loads remain slow.** Raw's first production-mode visit was 8.3 seconds in the final sample; later visits were 1.8–2.1 seconds. Live AI Calls and Assignments also had occasional slower samples. These were not controlled concurrency measurements, so this audit cannot assign every spike to a particular infrastructure cause.
- **Development is materially slower.** Warm AI Calls in the final preview was about 2.1 seconds and My Work about 1.3 seconds. Compilation, development rendering and effect replay add overhead; server-side database work also contributes. Port 3000 remains the live development preview. The temporary production comparison server was stopped.
- **Document size is not the main large-fetch finding.** The final production Raw document is about 480 KB decoded, but its measured compressed document transfer is about 44 KB including headers. AI Calls is about 35 KB and Assignments about 30 KB transferred. These figures exclude JS/fonts. The removed My Work evidence fetch affected server-to-database traffic, which browser request sizes do not reveal.
- AI history remains paginated at 50 calls and includes their evidence after its tab opens. It is not loaded for every table row. Audio uses `preload="none"`. A contact with unusually long histories could benefit from per-call evidence fetching later; that was not needed to solve the measured worklist over-fetch.
- Apply [009_dashboard_page_indexes.sql](../../database/migrations/009_dashboard_page_indexes.sql) through the existing migration runner against the intended database during deployment. It adds two indexes and changes no business rows. The preceding schema migrations remain required. This local audit applied 009 only to disposable test data; live measurements used read-only access.
- No new dependencies or environment variables are required for these changes.

## Verification and reproduction

Production build and type checking passed. Unit tests: **120 passed**. Affected integration tests: **85 passed**. The first affected browser run had 151 passes and six failures: five fixtures still intercepted the old combined Details URL, and one exposed the manual-history button opening Overview. After fixing those cases and the subsequent query changes, the final affected browser run had **81 passes**. The separate production volume suite had **2 passes**. The earlier [visual audit](../VISUAL_OVERHAUL.md#spacing-and-hierarchy-audit--14-october-2026) covers the completed spacing review and 164-state screenshot gallery.

Run one fixture-mutating suite at a time:

```bash
npm run check
npm run test:stage -- database
npm run test:stage -- integration filters.test.ts ai-attempts.test.ts batches-wallet.test.ts batch-live.test.ts
npm run test:stage -- build
npm run test:stage -- performance loading
npm run test:stage -- browser-volume-production
npm run test:stage -- browser-production 44-loading-efficiency.spec.ts
```

For an already configured local preview, the diagnostic scripts accept an authorized admin email, an explicit environment file and a report label:

```bash
node --env-file=<preview-env-file> tests/performance/profile-preview.mjs <admin-email> preview 3000
node --env-file=<preview-env-file> tests/performance/profile-readers.mjs <admin-email> readers --plans
```

The browser diagnostic is localhost-only and blocks non-GET/HEAD requests, including batch reconciliation. The SQL diagnostic pins an explicitly read-only transaction and bounds statements to 15 seconds. It measures query/response sizes and optionally sanitized execution plans, without saving SQL parameters, contact contents, credentials or cookies. Reports go to `/tmp`; sanitized before/after evidence is retained in [loading-audit.json](loading-audit.json).

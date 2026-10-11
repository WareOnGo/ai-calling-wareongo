# Performance validation — review build

This is synthetic local evidence, not a production SLA. PostgreSQL 17, six application connections, 50,000 source records/phones, 10,000 calls with approximately 3 KB transcripts, 5,000 assignments and manual attempts, 2,000 identified AI attempts and ten callers.

Run `npm run test:stage -- performance review2` on the dedicated local port 55439 database. It replaces that disposable fixture. All 19 benchmark workloads completed in one passing test, including a query-plan assertion that selective Raw search uses `bolna_raw_search_trgm`. Broad terms and short fragments can still scan many matches; indexing does not promise constant-time search.

Five sequential samples per reader. “Sample p95” below means the maximum of five, not a statistically robust percentile. These are application-reader times, including database round trips. Ten concurrent saves are measured as a group. The checked-in artifact contains compact samples; full EXPLAIN output is generated under `/tmp`.

| Case | Sample p95 |
| --- | ---: |
| Raw first page | 28 ms |
| Raw page 400 | 82 ms |
| Raw Unassigned | 379 ms |
| Raw search | 850 ms |
| Calls search | 549 ms |
| Raw filters | 72 ms |
| Calls first page | 42 ms |
| Calls page 200 | 43 ms |
| Calls filters | 110 ms |
| Assignments page 50 | 99 ms |
| My Work | 44 ms |
| Caller picker workloads | 45 ms |
| Team five-metric summary | 74 ms |
| Team selected evidence | 37 ms |
| Assignment preview, 250 targets | 324 ms |
| Select 20,000 matching IDs | 76 ms |
| Ten concurrent saves | 26 ms |
| Manual batch, 250 targets | 19 ms |
| AI batch, 250 targets | 7 ms |

The initial before-fix fixture hit 15-second statement timeouts on core grid reads. [Historical baseline](database-before.json), [current benchmark samples](database-review.json), [selective index-plan summary](search-index-review.json). These are the sole current timing figures used by the changelog and audit.

## Production browser workflow

Both volume scenarios passed: ordinary navigation/lazy details/scoped My Work and repeated streamed pages at 1.5 Mbps with 20 ms latency. No browser page errors were observed. Run after the performance fixture with `npm run test:stage -- browser-volume-production`.

| Page | Warm full-page readiness | Uncompressed document |
| --- | ---: | ---: |
| /dashboard/raw | 529–532 ms | 324086 bytes |
| /dashboard/raw?page=400 | 450–505 ms | 329078 bytes |
| /dashboard/calls | 471–609 ms | 258906 bytes |
| /dashboard/calls?page=200 | 464–488 ms | 256869 bytes |
| /dashboard/assignments?page=50 | 500–575 ms | 289194 bytes |
| /dashboard/team | 409–423 ms | 105339 bytes |
| manual_batch_250 | 248–253 ms | 122554 bytes |
| ai_batch_250 | 197–198 ms | 83160 bytes |

[Browser samples](browser-review.json). Documents include server HTML and React payloads, distinct from query JSON or compressed transfer size. Default Team loads its five-metric summary without a drill-down query; evidence loads only when selected.

The final benchmark ran on the temporary disposable PostgreSQL data directory after an earlier local disk-space failure. That interrupted run is not counted as success. Production data distribution, concurrency, migration/backfill duration and index storage still require staging measurements.

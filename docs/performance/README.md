# Performance validation — review build

For the latest dashboard investigation and measurements, see the [14 October loading audit](LOADING_AUDIT.md). The figures below describe the earlier review build.

This is synthetic local evidence, not a production SLA. PostgreSQL 17, six application connections, 50,000 source records/phones, 10,000 calls with approximately 3 KB transcripts, 5,000 assignments and manual attempts, 2,000 identified AI attempts and ten callers.

Run `npm run test:stage -- performance audit5` on the dedicated local port 55439 database. It replaces that disposable fixture. All 19 benchmark workloads completed in one passing test, including a query-plan assertion that selective Raw search uses `bolna_raw_search_trgm`. Broad terms and short fragments can still scan many matches; indexing does not promise constant-time search.

Five sequential samples per reader. “Sample p95” below means the maximum of five, not a statistically robust percentile. These are application-reader times, including database round trips. Ten concurrent saves are measured as a group. The checked-in artifact contains compact samples; full EXPLAIN output is generated under `/tmp`.

| Case | Sample p95 |
| --- | ---: |
| Raw first page | 33 ms |
| Raw page 400 | 68 ms |
| Raw Unassigned | 341 ms |
| Raw search | 735 ms |
| Calls search | 591 ms |
| Raw filters | 77 ms |
| Calls first page | 46 ms |
| Calls page 200 | 45 ms |
| Calls filters | 116 ms |
| Assignments page 50 | 109 ms |
| My Work | 48 ms |
| Caller picker workloads | 43 ms |
| Team five-metric summary | 47 ms |
| Team selected evidence | 40 ms |
| Assignment preview, 250 targets | 350 ms |
| Select 20,000 matching IDs | 83 ms |
| Ten concurrent saves | 27 ms |
| Manual batch, 250 targets | 30 ms |
| AI batch, 250 targets | 9 ms |

The initial before-fix fixture hit 15-second statement timeouts on core grid reads. [Historical baseline](database-before.json), [review benchmark samples](database-review.json), [selective index-plan summary](search-index-review.json). These figures are retained as evidence for that review.

## Production browser workflow

Both volume scenarios passed: ordinary navigation/lazy details/scoped My Work and repeated streamed pages at 1.5 Mbps with 20 ms latency. No browser page errors were observed. Run after the performance fixture with `npm run test:stage -- browser-volume-production`.

| Page | Warm full-page readiness | Uncompressed document |
| --- | ---: | ---: |
| /dashboard/raw | 543 ms | 326033 bytes |
| /dashboard/raw?page=400 | 487–551 ms | 331014 bytes |
| /dashboard/calls | 443–559 ms | 258906 bytes |
| /dashboard/calls?page=200 | 469–476 ms | 258516 bytes |
| /dashboard/assignments?page=50 | 534–558 ms | 289194 bytes |
| /dashboard/team | 252–322 ms | 104211 bytes |
| manual_batch_250 | 271–279 ms | 122790 bytes |
| ai_batch_250 | 235–262 ms | 83160 bytes |

[Browser samples](browser-review.json). Documents include server HTML and React payloads, distinct from query JSON or compressed transfer size. Default Team loads its five-metric summary without a drill-down query; evidence loads only when selected.

The completeness-audit benchmark completed on the temporary disposable PostgreSQL data directory. An earlier review’s disk-space failure is not counted as success. Production data distribution, concurrency, migration/backfill duration and index storage still require staging measurements.

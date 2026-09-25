# Bolna Processing: development audit

## Implementation follow-up

Verification after the refactor: 76 unit tests, 20 PostgreSQL integration tests,
TypeScript checks, a production build, and browser smoke checks passed.

The findings below describe the pre-refactor snapshot. The working tree now adds:

- Expiring, fenced event and analysis leases, attempt budgets and retry backoff;
  fact persistence is independent of OpenAI and atomic with acknowledgement.
- Transactional phone reservations, dispatch intent keys, durable provider IDs,
  retained uncertain states, provider reconciliation and audited manual resolution.
- Viewer-scoped assignment projections/history, atomic reassignment, entity/phone
  checks, admin-only dropping and optimistic call/assignment revisions.
- Typed request/filter validation, shared classification, snapshot CSV streaming,
  spreadsheet formula escaping and explicit export limits.
- Expiring signed sessions with a dedicated secret, serialized last-admin checks,
  verified database TLS, app-only versioned migrations and database regression CI.
- Grid-scoped DOM controls, stable column metadata, refreshed row geometry,
  bounded call-history projection and reduced dashboard-wide save notifications.

Rollout requirements and remaining operational limitations are documented in
[README.md](README.md) and [database/README.md](database/README.md). Migrations
001–005 have since been applied to production; current validation and migration
results are in [the production review](database/PRODUCTION_REVIEW.md). Production
schedule setup remains a separate rollout task. Private dataset pipelines and
the separate legacy browser harness remain outside this refactor.
The application still cannot make Postgres and Bolna one atomic transaction;
uncertain outcomes stay reserved until verified.


Reviewed application commit: `f4fbda6`.

The main architectural choices are suitable for this application: a Next.js
monolith, explicit Postgres queries, durable webhook capture, and small pure
modules for calling rules. The most urgent work is making multi-step operations
recoverable and authorization consistent. Moving files alone would not fix those
problems.

## Scope and evidence

Reviewed the API handlers, database/query layer, private schema artifacts,
authentication, dashboard state management, and existing test coverage.

Checks performed:

- `npm test`: **55 tests passed across five files**.
- `npx tsc --noEmit --incremental false`: **passed**.
- Eight controlled probes executed the actual TypeScript handlers/modules with
  database, identity, and provider boundaries replaced by synthetic fixtures.
  They confirmed the specific control-flow behavior recorded below.

The probes did not contact a real database or provider. They are not a substitute
for Postgres concurrency tests or browser tests. The existing browser harness was
reviewed but not run. No production state, query plans, deployment settings, or
dependency vulnerabilities were audited. Performance improvements below are
candidates to measure, not measured latency claims.

Priority definitions: **P1** means fix before expanding calling volume or access;
**P2** means address in the next reliability/refactoring cycle; **P3** means
maintainability or a measured optimization opportunity.

## Findings

### 1. P1 — A worker interruption can permanently strand captured events

Evidence: [claim and processing loop](src/app/api/process/route.ts#L39),
[failure persistence](src/app/api/process/route.ts#L185).

The worker claims the whole batch, marks every row `processing`, and commits
before processing sequentially. Future claims select only `pending` and `failed`.
There is no claim expiry, heartbeat, or recovery query for `processing` rows.

A function timeout can strand the current event and every unstarted event in its
batch. There is also a deterministic failure path: if processing fails and the
attempt to write `status = 'failed'` also fails, the exception aborts the loop.
The controlled probe claimed two events, injected a database outage, and observed
HTTP 500 after only the first event was attempted.

**Refactor:** introduce an event repository with an atomic claim operation,
`lease_expires_at`, a claim token, and an attempt increment on claim. Expired
leases become eligible again. Completion/failure updates must require the current
claim token so an old worker cannot acknowledge a newer worker's claim. Bound
external-call timeouts by the remaining request budget and avoid claiming more
work than the function can reasonably finish.

Persist normalized call facts before inference and enqueue inference separately.
This makes the existing best-effort intent hold even when the process is killed
before an OpenAI call returns.

**Regression coverage:** terminate a worker after claim; expire its lease;
recover the work; reject a late acknowledgement from the old claimant. Also
exercise failure while persisting failure.

### 2. P1 — Dispatch is vulnerable to duplicate calls and uncertain remote state

Evidence: [dispatch handler](src/app/api/raw/dispatch/route.ts#L40),
[Bolna transport](src/lib/dispatch.ts#L87),
[queued-number lookup](src/lib/raw.ts#L329).

The queued-number check, batch insert, item insert, provider creation, scheduling,
and final local update are independent operations. Two requests can both observe
a number as unqueued and schedule it. There is no unique active-number reservation
or request idempotency key.

The local database receives the provider batch ID only after scheduling succeeds.
If creation succeeds and the schedule response is lost, the catch block marks the
local batch `failed` without storing that ID. Failed batches do not reserve their
numbers, although the provider might already have accepted the schedule.

Controlled probes confirmed both the duplicate dispatch path under a shared
unqueued snapshot and the loss of the provider ID after a simulated schedule
response loss. These demonstrate application control flow; the database races
still need a real concurrency regression test.

**Refactor:** make dispatch a persisted workflow:

```text
prepared → creating → created → scheduling → scheduled → completed
                            ↘ reconciliation_required
```

Within one short database transaction, validate candidates, acquire unique active
reservations by canonical phone, and insert the batch/items. Accept an idempotency
key for the user's dispatch intent. Commit before contacting Bolna. Store the
provider ID immediately after creation, before scheduling. Retain reservations
when a remote outcome is unknown and reconcile it before retrying.

Do not hold a database transaction open across HTTP calls. A local idempotency key
alone cannot guarantee exactly-once provider creation; provider-supported
idempotency or explicit reconciliation is needed at that boundary.

**Regression coverage:** concurrent identical dispatches; item-insert failure;
provider creation success followed by timeout; accepted schedule with lost
response; final local update failure; retry of the same user intent.

### 3. P1 — Entity scope does not scope the assignment data returned with it

Evidence: [employee visibility](src/lib/scope.ts#L36),
[current assignment projection](src/lib/scope.ts#L56),
[raw assignment fields](src/lib/raw.ts#L91),
[call export fields](src/app/api/calls/export/route.ts#L32).

Consider a normal lifecycle:

1. Employee A finishes an assignment for a call or listing.
2. An administrator creates a new open assignment for employee B on that entity.
3. A still passes entity visibility because A's completed assignment is not
   dropped.
4. The display join selects the globally current assignment, which belongs to B.

The export/detail read paths can therefore return B's assignment remarks, result,
brief, or warehouse reference to A. Scoping the assignment-history query in the
details endpoint does not sanitize the separate entity payload. This follows
from the SQL predicates and projection; it was not reproduced against live data.

The call PATCH endpoint also treats historical completed ownership as sufficient
to edit shared call workflow fields. Whether past assignees should retain that
write capability needs an explicit rule.

**Refactor:** separate `canReadEntity`, `canEditCallWorkflow`, and
`canEditAssignment`. For employees, project their own relevant assignment rather
than the global current assignment. Keep the global assignment projection for
admins. Use explicit response types so internal query rows do not become API
responses automatically. If collaboration across assignees is intended, define
which fields are shared and test that policy explicitly.

**Regression coverage:** A-done/B-open fixtures on both entity types; inspect the
entire details JSON and CSV, not just visible table rows. Verify historical read
access separately from current write access.

### 4. P2 — Scheduled batches never stop reserving numbers

Evidence: [queued-number states](src/lib/raw.ts#L329),
[batch activity](src/app/api/batches/route.ts#L7).

The application writes `sending`, `scheduled`, and `failed`, but has no completed
batch transition. The activity endpoint counts received results without updating
state. A successfully completed scheduled batch keeps excluding its numbers
indefinitely unless something outside this code updates it.

**Refactor:** implement terminal batch/item states and release reservations only
after provider reconciliation establishes completion or cancellation. Do not
simply compare call-log count with item count: provider retries can produce
multiple executions for one number. Unknown states should remain reserved until
reconciled, with an explicit operator action if necessary.

### 5. P2 — Assignment transitions and integrity are enforced inconsistently

Evidence: [assignment PATCH](src/app/api/assignments/[id]/route.ts#L33),
[reassignment writes](src/lib/assignments.ts#L50),
[explicit-ID assignment](src/app/api/assignments/route.ts#L44).

Several related defects come from treating assignment changes as generic patches:

- An employee can PATCH their assignment to `dropped`, bypassing the dedicated
  admin-only DELETE route. A controlled probe returned 200 for this operation.
- Reassignment drops the old owner and inserts the replacement without a
  transaction. The probe injected an insert failure and observed the old
  assignment already dropped.
- Explicit IDs receive UUID-shape validation but no entity-existence or phone
  eligibility check. The polymorphic entity column has no FK, so invented or
  stale IDs can create unusable work. The filter path applies different rules.
- Reopening a completed assignment after another person receives an open one
  conflicts with the partial unique index. The API does not translate that
  conflict into an actionable response.

**Refactor:** expose commands such as `assign`, `reassign`, `complete`, `reopen`,
and `unassign`, each with a role/transition policy. Keep ordinary outcome/remarks
patches separate. Resolve both explicit selections and filters through the same
eligibility service. Deduplicate and validate IDs before counting them. Perform
reassignment atomically and return 409 for conflicting ownership.

For database integrity, either enforce polymorphic existence in a controlled
service or migrate to two nullable entity FKs with a CHECK that exactly one is
set. Keep one assignment/workflow model rather than duplicating the whole feature.

### 6. P2 — Inference has duplicate-work and stale-write risks

Evidence: [bulk selection](src/app/api/enrich/route.ts#L31),
[inference update](src/lib/enrich.ts#L20),
[worker upsert](src/app/api/process/route.ts#L123),
[manual inference](src/app/api/calls/[id]/enrich/route.ts#L14).

The bulk method is called `claimRows`, but only selects rows. Concurrent runs can
infer the same transcript. Failures receive no per-row backoff and are ordered
back to the front by cost; enough persistent failures can starve later work.

Writes match only the call ID. A slow inference can overwrite a newer result or
write analysis for an older transcript. The processing upsert can even replace
inference fields from an older run while retaining the greater version number,
making provenance misleading. The bulk writer can lower the version outright.

The automatic gate is duplicated in TypeScript and SQL; the manual endpoint
does not apply it. `ENABLE_ENRICHMENT` controls only inline inference. Some of
these may be intended distinctions, but names and contracts should express them.

**Refactor:** use an inference job keyed by call ID, transcript hash, and inference
version. Apply leases and retry scheduling. Accept results conditionally only
when the source hash/version still matches. Share one orchestration service for
bulk and manual requests, with an explicit authorized `force` option. Separate
inline-enrichment configuration from a true global inference pause.

### 7. P2 — API validation can silently change values or produce avoidable 500s

Evidence: [call field coercion](src/app/api/calls/[id]/route.ts#L9),
[assignment parsing](src/app/api/assignments/[id]/route.ts#L20),
[filter parsing](src/app/api/assignments/route.ts#L72).

A controlled call PATCH with `{ "added_to_db": "false" }` persisted `true`, because
the handler uses `Boolean(value)`. A body of valid JSON `null` throws in the `in`
operator instead of producing a validation response. Similar handwritten parsing
accepts arbitrary text conversions, malformed IDs, and unbounded/invalid numeric
configuration or query values in different ways.

TypeScript annotations on request bodies do not validate incoming JSON. Zod is
already installed and used at the webhook boundary, but not consistently here.

**Refactor:** introduce feature-specific Zod request/query schemas and a small
shared route error mapper. Validate actual booleans, UUIDs, positive bounded
integers, allowed states, and dates. Use discriminated input for IDs versus
filters. Return 400/422 for invalid input, 403/404 for access failures, and 409
for valid requests that conflict with current state. Preserve unexpected errors
in server logs with a request ID.

### 8. P2 — Call outcome semantics already differ between screens

Evidence: [raw latest outcome](src/lib/raw.ts#L100),
[queue classification](src/lib/queue.ts#L40),
[call view read](src/lib/calls.ts#L106).

Call analytics uses effective availability from the SQL view. Raw listings and
queue classification use `llm_availability` directly. A connected call stored
during an OpenAI outage has no model verdict: the call view shows `Unclear`, while
`deriveCat(1, null)` labels it `dead`/“No answer.” That is materially different
information when an operator decides which numbers to recall.

**Refactor:** separate connection outcome from property availability and inference
state. Share a canonical projection across call analytics, latest-call summaries,
queue warnings, exports, and My Work. “Connected but not analyzed” should be
representable without inferring “No answer” from a missing model value.

### 9. P2 — Export behavior is both unsafe for spreadsheets and unbounded in places

Evidence: [call CSV generation](src/app/api/calls/export/route.ts#L41),
[raw CSV generation](src/app/api/raw/export/route.ts#L42),
[call export query](src/lib/calls.ts#L175),
[raw export cap](src/lib/raw.ts#L206).

CSV escaping handles separators and quotes, but not formula-leading cell values.
A controlled export emitted the synthetic owner value `=1+1` unchanged.
Spreadsheet interpretation depends on the client, but source/user-controlled
values can become formulas rather than text.

Filtered call export has no row cap and builds all rows, cell strings, and the
final CSV in memory. Raw exports silently cap at 100,000 while the UI promises
all matching rows. Large explicit selections travel in the URL, and call exports
silently limit them to 1,000 IDs.

**Refactor:** use a spreadsheet-safe text-cell serializer for human downloads,
separate from Bolna's machine-consumed CSV contract. Add a consistent documented
limit and returned/exported row count, or stream with keyset pagination. Move
large selections into a POST body or server-side export job. Only introduce
background export storage if measured sizes require it.

### 10. P2 — Schema delivery is not reproducible from the application repository

Evidence: [ignored schema and scripts](.gitignore#L15),
[database commands](package.json#L14),
[Prisma configuration](prisma.config.ts#L31).

Schema, migrations, and maintenance scripts are entirely gitignored. Updates use
`db push` plus manually synchronized SQL, while the browser harness rebuilds from
another migration representation. The generated phone column, checks, extensions,
and view need special handling. A change can pass type checking yet be absent
from a new database or deployment.

Keeping source datasets and credentials private is correct. Keeping all schema
history outside a versioned release artifact creates a different problem.

**Refactor:** version schema-only migrations either in this private repository or
in a separate private package/repository pinned to the app release. Exclude data
and source-specific loaders as needed. Prefer one reviewed forward-migration
path for deployed environments. CI should create an empty disposable database,
apply migrations, and run schema/route integration tests. Supplementary SQL
belongs in that same migration path.

### 11. P2 — Authentication and account invariants need strengthening

Evidence: [session format](src/lib/auth.ts#L18),
[account updates](src/app/api/users/route.ts#L28),
[TLS configuration](src/lib/db.ts#L13).

The cookie has a browser expiry, but its signed payload contains only an email.
A copied valid token has no server-enforced expiration and can be replayed while
the account remains active and the signing key is unchanged. Secret fallback
also couples scheduler credentials and session signing unnecessarily.

Last-admin protection performs separate reads and a write. Two admins
concurrently demoting each other can both observe two active admins and both
proceed. This is a code-path concurrency concern, not an observed production
lockout.

Database TLS disables certificate verification, and the Prisma URL workaround
changes TLS negotiation separately. These should be explicit connection policies
rather than permanent hidden URL rewrites.

**Refactor:** require a dedicated session secret and use an established session
implementation or signed claims with issued/expiry times and a revocation version.
Keep account rechecks. Serialize role/deactivation changes around the last-admin
invariant in a database transaction. Configure the trusted database CA and make
development TLS configuration explicit. Validate the deployment's forwarded-host
handling when deriving OAuth URLs.

## Structural concerns and optimization opportunities

### Organize around feature boundaries and side effects

Current route handlers combine parsing, authorization, business transitions,
SQL, and provider calls. The most consequential orchestration is therefore harder
to test than the pure helpers. Meanwhile, some readers have no required viewer
argument and rely on callers remembering an assignee filter.

A useful target is:

```text
src/
├── app/api/.../route.ts       # Parse → authorize → call service → map response
├── server/
│   ├── db.ts                # Pool and transaction helper
│   ├── config.ts            # Validated server configuration
│   ├── auth/                # Session and capability policies
│   └── jobs/                # Lease/retry primitives, used by concrete jobs
├── features/
│   ├── calls/               # Contracts, scoped queries, inference service
│   ├── dispatch/            # State machine, repository, Bolna adapter
│   ├── assignments/         # Commands, transitions, scoped queries
│   └── dataset/             # Listing queries and canonical phone policy
└── components/dashboard/    # Shared presentation and interaction components
```

Keep pure types and helpers usable by the client. Keep DB/provider modules
server-only. Start by extracting the two risky workflows, not by moving every
file or creating a universal repository framework.

### Separate summary, detail, and export query shapes

[Raw reads](src/lib/raw.ts#L100) aggregate whole call histories and arrays of
transcripts just to select the most recent values. [Personal work](src/lib/personal-work.ts#L28)
uses full export readers to build a small work summary, pulling metadata and
history that its return value does not use. Details then call those same broad
readers again.

Use small `listSummaries`, `getDetail`, and `iterateExport` projections with shared
scope/filter predicates. For latest calls, test an ordered lateral query with
`LIMIT 1` instead of aggregating every transcript. Fetch counts separately when
needed, and paginate history in the detail endpoint.

Measure representative source, phone, assignee, and free-text filters with
`EXPLAIN (ANALYZE, BUFFERS)` on a safe representative dataset before adding indexes.
A composite latest-call index such as `(phone_id, call_created_at DESC, id)` is a
candidate to evaluate. Avoid assuming a materialized view or more caching is
needed before reducing the selected data.

### Give the browser a single owner for each piece of state

[Selection](src/app/dashboard/Selection.tsx#L11) queries document-wide checkboxes.
[Column resizing](src/app/dashboard/ColumnResize.tsx#L11) adds DOM nodes/classes
and retains row references. [DashboardUI](src/app/dashboard/DashboardUI.tsx#L65)
captures dashboard link clicks globally. These choices can work, but rely on
global selector conventions, remount behavior, and React not replacing captured
elements unexpectedly.

Retain server-rendered rows while introducing a table-scoped controller/ref for
selection, columns, and keyboard behavior. Give columns stable IDs independent
of header text, and render their structure from one definition. Avoid storing
selection payloads in both React state and independently queried DOM attributes.
Test same-URL refresh with changed rows as well as ordinary filter navigation.

The autosave state machine is worth retaining. Add a record revision to writes
for multi-tab/user conflicts. Its global status reporting currently updates a
shared context for every edit; split navigation context from save-status
subscriptions if profiling shows unnecessary rerenders. Dense one-line JSX and
duplicated filter parsing should be expanded or extracted where it makes these
flows easier to review.

### Consolidate contracts that currently rely on comments staying in sync

Examples include filter parsers across pages/exports/assignments, inference
eligibility in multiple SQL/TypeScript expressions, CSV escaping, and queue
preprocessing repeated in the modal and server. The dispatch helper's header
still says transport is not wired although it is live.

Share feature-level schemas and policy helpers. Distinguish optional manual
overrides from automatic policy. Validate environment variables once on the
server, with explicit feature switches and bounded sizes. Remove misleading
comments and unused environment settings as part of the affected refactor.

## Suggested delivery sequence

| Stage | Changes | Completion criteria |
|---|---|---|
| 1. Establish a reliable baseline | Pin schema artifacts; add disposable Postgres integration tests and route tests with fake providers. | A new checkout can build the same schema; failure/concurrency cases reproduce. |
| 2. Fix work and access integrity | Assignment transitions, transactional reassignment, entity validation, viewer-specific projections, session/account invariants. | A-done/B-open isolation and conflicting transitions have explicit tested outcomes. |
| 3. Make calling recoverable | Dispatch intent/idempotency, phone reservations, provider-ID persistence, unknown-result reconciliation, batch completion. | Retrying an intent cannot silently create another local send; uncertain provider outcomes stay visible and reserved. |
| 4. Make processing recoverable | Leased event/inference jobs, request deadlines, version/hash-conditional writes, failure backoff. | Killed workers recover; stale workers cannot acknowledge/write over newer work. |
| 5. Reduce query and UI complexity | Summary/detail/export projections, safe bounded exports, shared filters, scoped table controller, formatting. | Measure response size/query time improvements; browser behavior and draft recovery remain covered. |

For each stage, add tests around observable invariants, make the change in the
smallest feature boundary, and migrate existing rows explicitly. Treat file
movement as supporting work, not the deliverable.

## What to keep

- Next.js and Postgres as a single application architecture.
- Durable capture before acknowledging an external event.
- Parameterized SQL, `EXISTS` scope predicates, and explicit query control.
- Shared filter builders for related read surfaces.
- Human-owned fields separated from machine-generated analysis.
- Pure calling/routing helpers and the tested autosave state machine.
- Browser evaluation against a disposable database.

The application needs stronger transactions, state transitions, and recoverability
before it needs microservices, a new ORM, or a separate queue broker.

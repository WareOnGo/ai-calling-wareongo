# CallOnGo

Internal warehouse sourcing and verification application. It brings together a
master listing dataset, AI phone calls through Bolna, transcript analysis through
OpenAI, and employee follow-up in one dashboard.

There are two work channels:

- **AI calling:** an administrator selects listings, schedules a Bolna batch, and
  reviews the resulting calls and inferred property details.
- **Human verification:** an administrator assigns a listing or an existing AI
  call to an employee, who records the outcome and whether the warehouse was
  added to the business database.

This document describes the implementation in this checkout. It does not assert
that a particular migration, scheduler, or deployment is active in production.
Those are environment-specific operational facts.

The [Bolna DB Fixes checklist](BOLNA_DB_FIXES_PLAN.md) records the 22-item handoff,
implementation stages and validation. Apply the consolidated migrations through 008 before running
this version. Migration 009 adds pagination indexes; see the [loading audit](docs/performance/LOADING_AUDIT.md) for measured improvements and deployment status. The [requirement-by-requirement re-audit](docs/HANDOFF_COMPLETENESS_AUDIT.md)
links each original request to its implementation, tests and remaining limits.
The [browser interaction audit](docs/BROWSER_UX_AUDIT.md) records additional UI,
recovery and mobile fixes with Playwright evidence and screenshots.
The [full handoff changelog](BOLNA_DB_FIXES_CHANGELOG.md) and
[shareable screenshot PDF](BOLNA_DB_FIXES_CHANGELOG.pdf) summarize all implemented
workflow, database, API, performance, and audit changes, with recorded test results.
[Team metric definitions](docs/TEAM_METRICS.md) and the
[AI evidence contract](docs/AI_ATTEMPT_EVIDENCE.md) describe reporting boundaries.

## Contents

- [Architecture](#architecture)
- [Repository map](#repository-map)
- [Data model and ownership](#data-model-and-ownership)
- [Call capture and processing](#call-capture-and-processing)
- [Inference and classification](#inference-and-classification)
- [Dispatch and scheduling](#dispatch-and-scheduling)
- [Assignments and access control](#assignments-and-access-control)
- [Dashboard and query design](#dashboard-and-query-design)
- [Local setup](#local-setup)
- [Configuration](#configuration)
- [Database management](#database-management)
- [HTTP interface](#http-interface)
- [Deployment and operations](#deployment-and-operations)
- [Validation](#validation)
- [Current limitations](#current-limitations)

## Architecture

The application is a single Next.js service. Server components query Postgres
directly; route handlers provide authenticated mutations, exports, webhook
capture, and worker entry points. There is no separate always-running worker:
a scheduler invokes HTTP endpoints to perform bounded batches of work.

```mermaid
flowchart TD
    Sources[Private source datasets] --> Clean[Private cleaning and loading scripts]
    Clean --> Listings[(Listings and canonical phone numbers)]
    Admin[Administrator] --> Dashboard[Next.js dashboard]
    Employee[Employee] --> Dashboard
    Google[Google OAuth] --> Dashboard
    Dashboard --> Readers[Scoped SQL readers]
    Readers --> Listings
    Readers --> Analysis[bolna_call_analysis view]
    Dashboard --> Assign[Assignment APIs]
    Assign --> Work[(Users and assignments)]
    Work --> Analysis
    Dashboard --> Dispatch[Dispatch API]
    Listings --> Dispatch
    Dispatch --> Batches[(Batch audit, items and phone reservations)]
    Scheduler --> Reconcile[Batch reconciliation]
    Reconcile --> Batches
    Reconcile --> Bolna
    Dispatch --> Bolna[Bolna create and schedule APIs]
    Bolna --> Capture[Webhook capture API]
    Capture --> Events[(bolna_webhook_events)]
    Scheduler[External scheduler] --> Process[Process API]
    Events --> Process
    Process --> Logs[(bolna_call_logs)]
    Scheduler --> Enrich[Bulk enrichment API]
    Logs --> Enrich
    Enrich --> OpenAI[OpenAI inference]
    Enrich --> Logs
    Logs --> Analysis
    Listings --> Analysis
```

| Component | Implementation | Design reason |
|---|---|---|
| Web application | Next.js 16.4 App Router, React 19, TypeScript | Keep dashboard rendering and server operations in one deployment. Webpack remains the development/build bundler. |
| Runtime | Node.js route handlers; Vercel-oriented configuration | Database connections, crypto, and external API calls stay on the server. |
| Runtime database access | Parameterized SQL through `pg` | Keep explicit control over queue locking, joins, upserts, and filtered exports. |
| Database | Supabase Postgres | Store listings, call history, workflow, and the processing queue together. |
| Schema tooling | Versioned SQL and a transactional migration runner | Rebuild app-owned objects independently of private datasets and co-tenant applications. Prisma is optional introspection tooling. |
| Calling | Bolna batch API and execution webhooks | Separate outbound scheduling from asynchronous call results. |
| Inference | OpenAI SDK with a strict JSON response schema | Extract consistent fields from Hindi/Hinglish and Indian English transcripts. |
| Validation | Zod and Vitest | Validate external payloads and test consequential rules without live services. |

The operating model is an internal tool with bounded batches. Using Postgres as
the queue avoids another service, but database availability, connection limits,
and recovery from interrupted requests remain application concerns.

## Repository map

```text
bolna-processing/
├── src/app/
│   ├── api/                    # Webhooks, workers, auth, exports, mutations
│   └── dashboard/
│       ├── calls/              # AI call analytics
│       ├── raw/                # Master dataset and calling selection
│       ├── my/                 # Personal manual-call and AI-review work
│       ├── assignments/        # Admin assignment history
│       └── team/               # Account and role management
├── src/lib/
│   ├── db.ts                   # Shared Postgres pool
│   ├── bolna.ts                # Execution validation and normalization
│   ├── openai.ts               # Prompts, response schemas, inference version
│   ├── inference.ts            # Eligibility and result-to-column mapping
│   ├── process-events.ts       # Leased webhook processing and atomic acknowledgement
│   ├── call-jobs.ts            # Leased inference/district jobs and stale-result fencing
│   ├── enrich.ts               # Inference persistence inside a fenced transaction
│   ├── api.ts / filters.ts     # Typed request boundaries and common filter parsing
│   ├── export.ts / csv.ts      # Snapshot CSV streaming and spreadsheet escaping
│   ├── dispatch-service.ts     # Idempotency, reservations and durable provider checkpoints
│   ├── batch-reconciliation.ts # Provider status checks and audited resolution
│   ├── queue.ts                # Phone deduplication, categories, CSV generation
│   ├── dispatch-plan.ts        # Shared preview and server routing/validation
│   ├── agents.ts               # Configured Hindi and English agents
│   ├── dispatch.ts             # Live Bolna transport for one language batch
│   ├── routing.ts              # Region rules and schedule calculation
│   ├── auth.ts / users.ts      # Sessions, access lookup, accounts
│   ├── scope.ts                # Assignment visibility predicates
│   ├── assignments.ts          # Assignment writes and history readers
│   ├── calls.ts / raw.ts       # Scoped grid, export, and selection readers
│   ├── personal-work.ts        # Employee work lists and totals
│   └── autosave.ts             # Serialized client save state machine
├── database/                   # App-only baseline, forward migrations and runner
├── tests/integration/          # PostgreSQL regression tests; providers are mocked
├── aws/                        # Historical scheduler integration notes
├── prisma.config.ts            # Schema tooling connection configuration
├── .env.example                # Starting configuration; see corrections below
└── package.json
```

The following directories are intentionally gitignored and may exist only in an
internal checkout: `prisma/`, `sql/`, `scripts/`, `rawdata/`, `cleandata/`,
`exports/`, and `.claude/skills/`. They contain private schema, pipeline, or source
material. A normal clone can provision the app schema using `database/`. Private
source-import and historical maintenance scripts still require the internal checkout.

The browser evaluation project is a separate package at `tests/browser/` in this
workspace. It is not an application dependency.

## Data model and ownership

### Entity relationships

```mermaid
erDiagram
    raw_records ||--o{ raw_phones : has
    raw_phone_numbers ||--o{ raw_phones : identifies
    raw_phone_numbers o|--o{ bolna_call_logs : links
    call_batches ||--o{ call_batch_items : contains
    bolna_app_users ||--o{ bolna_assignments : receives
```

These are the principal foreign-key relationships. Additional **logical** links
are separate: webhook and call-log IDs share an execution UUID;
`bolna_call_logs.batch_id` matches `call_batches.bolna_batch_id`; assignment
`entity_id` identifies either a listing or a call. Those links are not all
foreign keys.

| Relation | One row represents | Important fields or constraints |
|---|---|---|
| `bolna_webhook_events` | One captured execution | Execution UUID primary key; original JSON; queue state, retry count, due time, error. |
| `bolna_call_logs` | One normalized call | Same execution UUID; call facts, inference, human workflow, canonical `phone_id`. |
| `bolna_call_analysis` | One call, as a SQL view | Effective availability, follow-up segment, source matches, current assignment. |
| `raw_records` | One source listing | UUID plus unique `(source, source_record_id)`; searchable columns and JSON metadata. |
| `raw_phone_numbers` | One canonical number | Unique `phone_last10`; numeric surrogate `phone_id`; formatted phone. |
| `raw_phones` | One listing-to-number association | Unique `(master_id, phone_id)`; `is_primary`. |
| `bolna_dispatch_requests` | One confirmed selection | Intent key/hash, routing mode and aggregate counts across language batches. |
| `call_batches` | One agent batch | Parent dispatch, resolved agent ID/language, lifecycle, counts, durable Bolna ID, error and resolution audit. |
| `bolna_dispatch_reservations` | One active reservation per normalized phone | Unique phone key prevents concurrent batches from claiming the same number. |
| `bolna_call_jobs` | One job per call and analysis kind | Input hash, inference version, expiring lease token, attempts, backoff and completion. |
| `call_batch_items` | One number selected for a batch | Batch FK; listing ID and contact data captured at dispatch time. |
| `bolna_app_users` | One account | Email primary key; name, admin/employee role, active flag. |
| `bolna_assignments` | One assignment episode | Polymorphic entity ID, assignee, brief, state, result, remarks, warehouse reference. |

### Why phone numbers connect calls to listings

A listing can have several numbers, and a number can appear on several listings.
Joining calls directly to listings would duplicate calls and imply a certainty
the data does not provide. The canonical phone table provides a shared identity,
while `raw_phones` preserves the many-to-many listing relationship.

Numbers are compared using their last ten digits. The worker uses `from_number`
for inbound calls and `to_number` otherwise, ensures a canonical row exists,
and writes its `phone_id` onto the call. Ten-digit numbers receive a `+91`
formatted value. Missing numbers resolve to an empty-string canonical key. This
normalization assumes an Indian dataset; it is not international phone parsing.

`bolna_call_logs.phone_last10` is a generated database column. The surrogate key
supports the FK without coupling it to updates of a generated string. The current
Prisma model permits a null `phone_id`, although the normal worker path resolves
one before inserting a call.

### Listing schema and ingestion decisions

Common operational fields such as owner, area in square feet, city, state,
address, and contact type have ordinary columns. Less consistent source
attributes live in `metadata` JSONB. This keeps common queries stable while
allowing source adapters to preserve extra fields without a migration per key.

The private cleaner normalizes area units, splits phone cells, harmonizes metadata
keys, and retains selected originals such as `area_sqft_raw` and `owner_name_raw`
when cleaning them. It removes known junk metadata, so it is not an archival copy
of every source byte. Original datasets remain a separate artifact.

State resolution follows curated city mappings, optional model-assisted gap
filling, and canonical-state validation. Known city mappings override conflicting
source states. A number reused on at least three listings is the basis for the
`probable broker` heuristic; an unflagged contact is presented as an owner.
Neither label independently verifies ownership.

Preserve listing UUIDs during refreshes. Natural-key upserts can retain them;
truncating and recreating listings can orphan assignments and historical batch
references, which have no listing FK to repair them.

### Separate machine facts from human work

| Data | Writer | Reason for separation |
|---|---|---|
| Call facts and accepted provider snapshot | Processing worker | Trace results back to the execution. |
| Model verdict, extracted fields, inference JSON/version/model | Worker and enrichment endpoints | Recompute analysis independently of employee results. |
| `m_call_status`, `called_by`, `added_to_db`, `wh_id` on a call | Retained legacy metadata | Read-only; current manual work and onboarding are stored on assignments. |
| Outcome, remarks, `added_to_db`, `wh_id` on an assignment | Assignee or administrator | A manual call has no Bolna log row; its deliverable belongs to its assignment. |

The two `added_to_db`/`wh_id` pairs are independent and are not automatically
synchronized. Setting them records business work; this app does not itself create
a warehouse in an external business database.

The database is shared with another application that owns unprefixed relations
including `calls`, `contacts`, `assignments`, and `employees`. Follow the established
`bolna_`/`raw_` namespaces for new tables and preserve unrelated models during
schema changes.

## Call capture and processing

Source: [webhook handler](src/app/api/bolna-webhook/route.ts),
[execution adapter](src/lib/bolna.ts), and
[processing worker](src/app/api/process/route.ts).

### Capture is the durability boundary

`POST /api/bolna-webhook` authenticates, parses JSON, validates the fields the app
uses, and merges the accepted provider facts. Zod allows additional fields so a
new provider field does not break ingestion. Optional duration/retry metadata
accepts number, string and null variants; duration is normalized later.

Identified provider dials are merged into one row per execution/provider-call ID.
These terminal statuses also retain their latest accepted snapshot in the processing queue:

```text
completed, failed, busy, no-answer, canceled, stopped,
error, balance-low, call-disconnected
```

Non-terminal events receive HTTP 200 after the per-dial upsert. Invalid JSON receives 400,
invalid payloads 422, and failed authentication 401. A database insert failure
returns 500 so the sender can retry. Capture makes no OpenAI or Bolna API calls.

Repeated deliveries update the same dial; no separate immutable delivery ledger is kept.
Identified provider call IDs retain separate attempts. Retry index, provider identity, status
progression and explicit provider timestamps determine whether a delivery can
advance the execution projection. Older events cannot rewind it. Sparse newer
updates retain known attempt metadata and call-log fields for the exact provider
dial, including facts received while ringing. New provider IDs do not inherit
another call's speech or duration. Missing dial identity falls back to the incoming
payload; unknown ordering remains conservative.
See [the evidence contract](docs/AI_ATTEMPT_EVIDENCE.md).

### Postgres acts as the job queue

`claimEvent()` atomically selects one due row with `FOR UPDATE SKIP LOCKED`,
increments attempts, and writes a random lease token with a 90-second expiry.
Workers claim just before processing, within a request deadline; they do not
claim a whole batch and then wait on external services. Expired processing rows
become eligible again. The default request ceiling is 20 events, capped at 100.

Normalization, canonical-phone linkage, the call upsert, and event acknowledgement
run in one transaction. That transaction locks and verifies the current lease
before writing. A superseded worker cannot acknowledge or overwrite a reclaimed
job. Missing/invalid customer numbers do not create a shared empty phone identity.

Caught failures use `min(2 ^ attempts, 60)` minutes of backoff. Claims, including
crashed runs, count toward `max_attempts` (default 8). Exhausted rows remain visible
for operator inspection. If recording the failure also fails, the existing lease
still expires and the worker proceeds to other work.

### Keep ingestion independent of inference

Processing makes no OpenAI requests. It refreshes provider-owned call facts,
including cost, duration and recording URL, while preserving human workflow fields.
Changed transcript/status/cost invalidates old inference; changed location inputs
invalidate inferred district data. Retries are handled by the separate analysis
jobs, so model outages cannot delay saving call facts.

The database transaction guarantees an atomic log write and acknowledgement.
External inference remains retryable work, not an exactly-once side effect.

## Inference and classification

Source: [prompts and schemas](src/lib/openai.ts),
[eligibility rules](src/lib/inference.ts), and
[shared inference writes](src/lib/enrich.ts).

### Business meaning of the verdict

Inference version **3** asks whether the owner has warehouse or commercial space
available. An alternative property offered during the call counts as available;
so does confirmed availability followed by a callback request. A greeting alone
does not count as confirmation.

The result contains `availability` (`Available`, `Unavailable`, `Unclear`),
`built_up_area_sqft`, `carpet_area_sqft`, `city_area`, `expected_rent`, `possession`,
`confidence`, and short explanatory `notes`. Carpet and built-up measurements are
stored and displayed separately; the question/answer context determines which
field to fill. Ambiguous measurements are left empty. Area and rent remain
strings; rent preserves its unit.
Unknown details use empty strings. Low confidence sets `needs_review`.

Strict JSON-schema output constrains response shape, not factual correctness.
Empty responses and parsing/API errors can still fail. Near-empty transcripts
return a deterministic low-confidence `Unclear` result without an API request.

### Eligibility and versioning

Automatic property inference requires all three conditions:

1. Status is `completed` or `call-disconnected`.
2. `total_cost` is strictly greater than `INFERENCE_MIN_COST_CENTS`, default
   `0.04`, using the application's interpretation of Bolna cost units as cents.
3. The transcript contains non-whitespace text.

Bulk enrichment selects only unenriched or older-version calls and claims each
through `bolna_call_jobs`. The claim includes an input fingerprint, model/prompt
version, random lease token, attempts, and 120-second expiry. Calls are selected
under locks; concurrent manual and scheduled requests cannot claim the same
current input. Analysis failures back off exponentially and stop after eight
claims. Changing the input or inference version creates fresh eligible work.

OpenAI requests have a 35-second timeout and no hidden SDK retries. Before writing,
the job transaction verifies its lease, current input fingerprint, and that a
newer inference version has not already been stored. District jobs use the same
mechanism with transcript, locality, and source area in their fingerprint.

`ENABLE_ENRICHMENT=false` disables property, district, and per-call inference.
Manual inference obeys the same eligibility checks. Admins may explicitly submit
`{ "force": true }` to rerun current analysis or retry an exhausted job, while
retaining the connection/cost/transcript gate and excluding an active same-input
lease. Bump `INFERENCE_VERSION` when changing the prompt or result schema.

### Classification has one database policy

`bolna_call_analysis` applies deterministic rules over stored facts:

- `busy` and `no-answer` produce `Unclear` and remain retryable. They never prove that a number is permanently invalid.
- Connected calls use the model verdict, defaulting to `Unclear` when absent.
- Other statuses default to `Unclear`. Hangup reason/status then selects
  `followup_hungup`, `followup_silent`, `followup_voicemail`, `followup_retry`, or
  `followup_other`. Resolved availability has an empty segment.

Updating the view reclassifies history without paying for inference again. The
model's original verdict remains in `llm_availability` for human comparison.

The optional district endpoint selects calls whose source recipient `area` is
empty or SQL null and whose `inferred_district` is null, provided transcript/locality signal
exists. An undetermined result is stored as `''` to avoid reselection. This is a
separate versioned job kind; its stored district is not currently projected by
`bolna_call_analysis` into the main call reader.

## Dispatch and scheduling

Source: [queue utilities](src/lib/queue.ts),
[batch planning](src/lib/dispatch-plan.ts), [transport](src/lib/dispatch.ts),
[routing](src/lib/routing.ts), and
[dispatch handler](src/app/api/raw/dispatch/route.ts).

**Dispatch is live: scheduling a batch places real phone calls.** The API requires
an admin session and `confirm: true`, and the UI has a confirmation step.

### Selection is reconstructed on the server

The browser sends record IDs and a filter snapshot. The server fetches current
contact data from Postgres and rebuilds the callable set; client-supplied phone
numbers are never used. The snapshot is stored for audit, not reapplied as a
second dispatch filter.

The pure `assembleBatch()` helper narrows candidates in this order:

```text
deduplicate number → optional category exclusions → language routing
                   → already queued exclusion → valid normalized phone
```

Its accounting reports the candidate count after deduplication and rows removed
at each stage. Already-called categories are `dead`, `unclear`, `available`, and
`unavailable`; an empty category means never called. Excluding a past outcome is
an operator choice, rather than a blanket prohibition on calling again.

The UI sends the selected IDs, category exclusions and routing mode. Preview and
server dispatch share the same planner; the server rechecks current data and
reservations before making any provider request.

### Routing and provider contract

The default **Automatic — by state** mode routes Tamil Nadu, Kerala and Karnataka
to English, and other or unspecified states to Hindi. Comparison ignores case
and surrounding spaces. **Hindi only** retains the three-state holdback;
**English only** routes all callable records to English. State is a routing rule,
not an inferred language preference. If the required agent is unconfigured,
those contacts remain held; there is no fallback to the other language.

A mixed selection creates two independent provider batches with one common
schedule. The preview, confirmation, results and Recent batches show each agent.
Both agents send execution webhooks to the same authenticated endpoint. Call
history and exports retain the provider agent ID and show its language label.
The dashboard does not change either agent's voice, transcription or greeting.

The transport implements two requests: create a batch by uploading a multipart
CSV, durably record its returned ID, then schedule that ID. Its provider assumptions are encoded in
[routing.ts](src/lib/routing.ts) and [dispatch.ts](src/lib/dispatch.ts):

- CSV columns are `name,property_type,contact_number,area`. Property type is
  `warehouse`; `area` is the listing city, not square footage.
- CSV output uses a UTF-8 BOM, CRLF line endings, and quoting for commas, quotes,
  and newlines.
- The filename uses the most frequent cities, scheduled date in IST, language,
  and local batch UUID for reconciliation.
- The scheduling slot is a ten-minute UTC boundary with four minutes of initial
  headroom: two for the provider's minimum plus two for the upload/request budget.
  It is formatted with a numeric `+00:00` offset.
- The create request asks Bolna for three retries at 30, 60, and 120 minutes.
  Optional `BOLNA_FROM_NUMBER` supplies a caller-number override.

### Persist the attempt before contacting Bolna

Each request includes a UUID `intentKey`, selected IDs, exclusions, `routingMode`
(`auto`, `hindi`, or `english`), and explicit confirmation. The current UI always
sends its selected mode, initially `auto`. Older clients that omit the mode retain
Hindi-only routing so a stale preview cannot authorize additional English calls.
The server fingerprints
the normalized selection and mode. Reusing that key returns the existing result;
changing the selection or mode under the same key returns
409. The key is retained on the modal's request, and reservations survive browser
reloads independently of client state.

A short Postgres transaction serializes reservation checks, inserts the parent
request, child batches and items, and reserves all normalized phones using a
shared unique key. It also checks legacy active batch items. The transaction ends
before contacting Bolna. Concurrent requests cannot send overlapping numbers,
including across different agents, even if both previews were loaded first.
Resolved agent IDs are frozen on each child. Replaying an accepted intent after
a configuration change still returns its existing batches.

The lifecycle is `creating` → `scheduling` → `scheduled` → `completed`. The provider
ID is persisted before the scheduling call. Both provider requests have explicit
timeouts. Any ambiguous create/schedule response leaves the batch `uncertain`,
with its error and reservations retained. Create and schedule are never blindly
retried. There is no transaction spanning Postgres and Bolna and no claim of
exactly-once remote execution. Each child advances independently: one can be
scheduled while the other remains uncertain. The response contains a `batches`
array and aggregate `state` (`partial` when only some children are confirmed).
Replaying the parent never resends either child. Resolve each affected batch in
Recent batches; only that child's reservations are released.

`/api/batches/reconcile` polls known provider IDs, including running batches, and
imports missed execution updates into both call results and attempt history.
Current Bolna batches report
`completed` after their configured retry cycle. Completion requires that provider
state, matching contact counts, coverage of every target and finished executions.
Legacy `executed` snapshots still require explicit retry exhaustion. A provider
`stopped` batch becomes locally canceled only after its target executions have
finished; no stop or cancel request is sent to Bolna. Recent batches lets
an admin check provider status or record a verified completion/cancellation note,
including who released the numbers. That action does not cancel calls remotely.
Stale in-flight states and legacy failures require reconciliation; a timeout alone
never frees a phone. A disconnected call still awaits its final update. Imports
commit in pages of 250, up to 1,000 executions per invocation. Active batches resume
by execution ID and wrap for another sweep; finished batches use a snapshot
fingerprint so changed results are rechecked before completion. Expiring leases
fence overlapping workers.

While a batch page is visible, `/api/batches/sync` checks up to three of its active
batches, sharing a five-minute throttle with background polling, and refreshes the page every
30 seconds. It pauses during edits, dialogs and background tabs. The existing
reconciliation cron remains responsible for checks when the page is closed.
Provider metadata requests time out after 15 seconds; large execution snapshots
have 45 seconds. Polling yields between batches to fit the request budget.
Result progress on a card is separate from confirmed batch completion.

Provider contracts: [batch status](https://www.bolna.ai/docs/api-reference/batches/get_batch),
[batch executions](https://www.bolna.ai/docs/api-reference/batches/executions), and
[automatic retries](https://www.bolna.ai/docs/outbound/auto-retry).

## Assignments and access control

Source: [auth](src/lib/auth.ts), [scope](src/lib/scope.ts),
[assignment persistence](src/lib/assignments.ts), and
[user management API](src/app/api/users/route.ts).

### One assignment table for both channels

An assignment targets `entity_type = 'record'` for manual calling or `'call'`
for AI-call follow-up. A partial unique index permits at most one `open`
assignment per `(entity_type, entity_id)`. Open ownership also spans all normalized
phones shared by listings and AI executions. Source properties remain distinct.
Database checks against current contact mappings and serialized allocation prevent two callers from taking
new overlapping work; existing legacy conflicts remain available for review.

States are `open`, `done`, and `dropped`. Reassignment closes another person's
open assignment and creates a new one; open work already owned by the target
is retained. Without `reassign: true`, existing open assignments are skipped and
reported. Completed rows remain history and do not prevent new assignments.

Bulk assignment accepts explicit IDs or approved filter fields. For filtered
assignment, the server resolves the set and excludes phone-less raw records.
Targets must be active accounts; requests are capped at 20,000 IDs. A preview
shows owners, history, eligibility and caller workloads. Single-caller or
deterministic round-robin allocation creates a durable manual batch, with a stale
preview check, transaction rollback and retry-key replay.

Assignees record explicit manual attempts with disposition, event time, optional
reported duration and follow-up date. Corrections preserve the original event;
legacy `attempts` counters are not evidence. `last_attempt_at` now reflects the
latest effective logged event. Human outcomes stay separate from AI verdicts.
Retryable dispositions stay open unless a caller explicitly chooses Exhausted
and records a substantive reason; there is no automatic attempt cap.
Available completion requires a valid warehouse
reference; Unclear requires a closure reason and substantive explanation. An
append-only assignment audit supports reopen history and team reporting.

The Call Analytics **Legacy Called By** field is labelled, hidden initially even
for existing column preferences, and read-only. It is not proof of who called.
Actual caller attribution comes from logged attempts. Call Analytics reports saved
manual notes, Added status and WH ID as text, with explicit empty states. Edit
these values in My Work, using the assignment's revision and validation.
Becoming Done requires a logged attempt. Existing Done edits skip that prerequisite but still validate result, WH ID, notes and closure. Invalid legacy completion data must be repaired or reopened before relevant edits.
New or changed warehouse references must be positive integers. Unchanged legacy
references remain visible, exportable and included in historical reporting, with
quality flags. Unmatched legacy call-row Added/WH values remain visible separately.

### The database grants access

Google OAuth verifies identity and email verification. `bolna_app_users` then
decides access and role on subsequent requests:

| Account state | Result |
|---|---|
| Active row | Admit with the stored role. |
| Inactive row | Deny. |
| No row | Deny, except for the bootstrap rule. |
| Database lookup fails | Deny access. |

`ADMIN_EMAILS` bootstraps an email **only when that email has no user row and no
active admin exists**. Existing inactive or employee rows take precedence; this
variable does not promote or reactivate them. Create an active admin row through
Team after first sign-in. Once an active admin exists, bootstrap cannot admit
additional accounts. `ALLOWED_EMAILS` is unused.

User-management guards reject self-demotion/self-deactivation and removing the
last active admin. Account state is rechecked per request, so access changes
require neither a redeploy nor a new session cookie.

### Session and authorization boundaries

`bp_session` contains a signed, versioned payload with email, issue time and expiry.
The server checks HMAC-SHA256 in constant time and rejects expired, future-issued,
malformed or legacy tokens. Cookies remain HTTP-only, `SameSite=Lax`, Secure in
production and valid for 30 days. `SESSION_SECRET` is mandatory and independent
of worker/OAuth secrets. Rotating it invalidates all sessions.

OAuth uses a short-lived state cookie. Callback URLs derive from forwarded
protocol/host headers and the request host. `GOOGLE_REDIRECT_URI` is not read.
Register the actual callback URI emitted for each environment with Google.

There is no authentication middleware. Pages explicitly call `requireUser()` or
`requireAdmin()`; APIs call their corresponding session guards. Every new route
must add its own guard. React `cache()` deduplicates access resolution within a
request rather than caching permissions across requests.

Employee entity visibility uses an `EXISTS` predicate against non-dropped
assignments. Done work remains readable, but an employee can change shared call
workflow fields only while holding the open assignment. Assignment projections
are separately scoped to the viewer, so a previous owner sees their own history
without receiving the next owner's notes through grids, details or exports.

Assignment history readers require a viewer. Assignment updates enforce ownership
and the expected `revision` within the SQL update; employee `dropped` transitions
are forbidden. Reopening work already owned by someone else returns a conflict.
Bulk reassignment verifies active assignees, entity existence and raw phone
eligibility, locks entities in deterministic order, and drops/inserts atomically.

Every call/assignment PATCH must include its current numeric `revision`; successful
writes return the incremented version. Stale or inaccessible edits return 409
without revealing another user's row. Boolean and text values, IDs, dates and
numeric filters are validated before SQL. Removing the last active admin is
checked under a transaction lock shared by all account writes.

Authorization remains application-enforced rather than per-user Postgres RLS.
Keep new entity readers within these scoped modules; a raw pooled query does not
inherit the browser user's permissions.

Administrators can switch to Employee view through `bp_view`, narrowing their
effective role and data access. Switching back is allowed only while the current
database account remains an admin; the preference cannot grant admin access.

## Dashboard and query design

### Pages

| Page | Audience | Purpose |
|---|---|---|
| `/` | Public | Google sign-in and access errors. |
| `/dashboard` | Signed-in users | Role-aware navigation and workload counts. |
| `/dashboard/raw` | Admin | Search listings, export, assign, and prepare calling batches. |
| `/dashboard/calls` | Signed-in users; scoped for employees | Call results, transcripts, inference and saved manual-work reporting. |
| `/dashboard/my` | Signed-in users, including admins | Own manual-call and AI-review assignments, independently paginated. |
| `/dashboard/assignments` | Admin | Assignment history and human/AI comparison. |
| `/dashboard/team` | Admin | Team performance, date filters, caller metrics and evidence drill-downs. |
| `/dashboard/team/access` | Admin | Search members, grant/revoke sign-in access and manage roles. |
| `/dashboard/batches` | Admin | Paginated AI/manual batches, stable membership, metric cards and CSV. |

### Shared query rules

[calls.ts](src/lib/calls.ts) and [raw.ts](src/lib/raw.ts) each have a common filter
builder for grids, exports, and ID resolution. Employee scope is added before
user filters. User values are parameterized, and existence predicates avoid
multiplying entities with several phone or assignment rows.

Search uses up to six whitespace-separated terms. Each term must match a
searchable column through substring matching or `pg_trgm.word_similarity` above
0.5 on selected text columns. Similarity is evaluated per column so a long
concatenated record does not dilute a short name. Grids highlight substring
matches using the same terms.

The call view attaches source matches with `LEFT JOIN LATERAL`. Counts and source
names cover all matches; the JSON array includes at most 12. Ranking prefers
unflagged contacts, primary-phone matches, and newer ingestion times. This bounds
response size and keeps one row per call, but the representative listing does
not prove which property was discussed. Call source filters search all matched
sources. City, state, source, contact type and source-size bounds must match the
same source listing. Source cities are displayed separately from AI location text.
Multi-select categories use repeated URL keys: OR within a category, AND between
categories. Grids, counts, exports and all-matching bulk actions share the filters.
Call Analytics hides `balance-low` by default; batch diagnostics and explicit
status/include-blocked filters retain access.

Calls default to 25 rows per page, raw listings and assignment history to 50,
and personal work to 25 per channel. Filter-option queries have a ten-minute
cache, so current records can precede new dropdown values.

Both CSV endpoints support POSTed selections and filters, with GET compatibility.
They count and stream a consistent database snapshot using a cursor and batches
of 250 rows. The shared 100,000-row ceiling returns 413 before streaming rather
than silently truncating data. Responses include `x-export-row-count`. Explicit
IDs are validated and no longer truncated to 1,000 or placed in long browser URLs.
Spreadsheet-bound cells neutralize formula prefixes; provider upload CSV remains
literal so Bolna receives valid phone values. Filter-based assignment/calling
selection still caps at 20,000 and reports that ceiling.

Grid reads select a bounded page before expanding ownership and carry only
240-character transcript/note previews. Full transcripts and recent execution
history load on demand in Details; AI attempt and manual-event timelines paginate
separately. CSV retains full evidence. Stable ID tie-breakers and page jumps keep
pagination deterministic. [Performance measurements](docs/performance/README.md)
document the volume fixture and before/after results.

### Server rendering with focused client components

Async server components fetch and render tables. Client components provide
selection, dialogs, filtering navigation, editing, and delegated keyboard and
clipboard behavior. This keeps database access on the server without moving the
entire table into a client-side grid library.

Admin grids favor dense scanning, frozen identifying columns, column resizing,
hide/show controls, and collapsible groups. My Work favors readable context and
visible form controls. Detail dialogs fetch scoped entity data and assignment
history when opened, keeping long transcripts out of the initial table layout.

URL query parameters hold filters and pagination. Saved views use `localStorage`,
scoped by account and route; column/group preferences use route-based storage.
They are browser preferences, not shared database objects.

### Autosave protects edits through slow and failed requests

[Autosave](src/lib/autosave.ts) permits one in-flight write per mounted editor,
compares later edits against the last confirmed value, and follows up after edits
during a request. Failed fields require explicit retry. A lost response is an
uncertain write, rather than proof that nothing saved.

[useAutosave](src/app/dashboard/useAutosave.tsx) recovers unsaved drafts from
tab-scoped `sessionStorage` without sending them automatically. The dashboard
shows save/error state and guards navigation while changes are pending. This
handles client request ordering; there is no database revision check for
conflicting edits from different tabs or users.

## Local setup

### Prerequisites

- Node.js 22.12+ within the 22.x line, or another version supported by the installed
  dependencies. The current Prisma package declares `^20.19 || ^22.12 || >=24.0`;
  private scripts also use Node's environment-file support.
- npm and an existing compatible Postgres database with TLS enabled.
- Google OAuth credentials and an active account or valid bootstrap email for
  dashboard access.
- Bolna credentials for dispatch/backfill and an OpenAI key for inference when
  those features are needed.

### Run against an already provisioned database

From `bolna-processing/`:

```bash
npm ci
cp .env.example .env.local
```

Populate `.env.local` using the configuration tables below. Then:

```bash
npm run dev
```

The app serves on `http://localhost:3000`. In another terminal:

```bash
curl --fail-with-body http://localhost:3000/api/health
```

Health checks database access and the event relation, not the complete dashboard
schema and reports expired/exhausted job counts. The database also needs `bolna_call_analysis`, user/assignment tables,
and required extensions. First sign-in does not auto-create a user row: a
bootstrap admin should create their own active admin row in Team.

For a fresh database, use the tracked app-only baseline and follow
[Database management](#database-management). The app does not apply migrations
at startup or during `next build`.

## Configuration

Use [.env.example](.env.example) as a starting point. Keep real credentials
in environment configuration, not committed files.

### Connections and authentication

| Variable | Requirement/default | Actual use |
|---|---|---|
| `DATABASE_URL` | Required by the app | Runtime Postgres connection, normally through the Supabase pooler. |
| `DIRECT_URL` | Required for Prisma commands | DDL/session-capable connection; no `DATABASE_URL` fallback in `prisma.config.ts`. Private Node scripts prefer it when present. |
| `SHADOW_DATABASE_URL` | Optional | Disposable schema-replay database for Prisma operations that need one. |
| `BOLNA_WEBHOOK_SECRET` | Required for capture | Query `token` or `x-webhook-secret` header. |
| `PROCESS_SECRET` | Required for worker endpoints | Bearer header or query `token` on process/enrich/district. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Required for OAuth | Google identity flow. |
| `SESSION_SECRET` | Required | Dedicated session HMAC key; there are no fallback secrets. |
| `DATABASE_SSL` | Verified TLS by default | `disable` is for isolated local Postgres; `insecure` is an explicit certificate-verification escape hatch. |
| `DATABASE_SSL_CA` | Optional for the app | PEM certificate authority override. The app includes Supabase's public root CA for Supabase database hosts; the migration CLI requires an explicit CA for private certificates. |
| `ADMIN_EMAILS` | Optional comma-separated list | First-admin bootstrap, subject to the rules above. |
| `ENFORCE_BOLNA_IP` | `false` | Exact string `true` enables a source-IP check. |
| `BOLNA_WEBHOOK_IP` | `13.203.39.153` in code | Expected first `x-forwarded-for` value when enabled; confirm for the deployment. |

[db.ts](src/lib/db.ts) reuses one pool per warm Node process, with at most six
connections and ten-second idle/connect timeouts. It strips conflicting URL
parameters, verifies TLS by default, and supports a custom CA. Statements time out
after 15 seconds; idle transactions after 20 seconds. CSV streaming holds one
connection per active export and uses a read-only repeatable-read transaction.
The migration runner prefers `DIRECT_URL`; runtime reads use `DATABASE_URL`.
Use a session-capable connection for migration operations.

### Inference and worker tuning

| Variable | Code default | Actual use |
|---|---|---|
| `OPENAI_API_KEY` | None | Required when inference reaches OpenAI. |
| `OPENAI_MODEL` | `gpt-4o` | Shared property/district model; template matches the code default. |
| `ENABLE_ENRICHMENT` | Enabled unless exactly `false` | Global switch for all property and district inference. |
| `INFERENCE_MIN_COST_CENTS` | `0.04` | Strict lower cost threshold for automatic property inference. |
| `PROCESS_BATCH_SIZE` | `20` | Sequential claims per request, bounded by a deadline; maximum 100. |
| `ENRICH_BATCH_SIZE` | `24` | Calls per bulk enrichment request. |
| `ENRICH_CONCURRENCY` | `4` | Concurrent tasks within bulk enrichment and district requests. |
| `DISTRICT_BATCH_SIZE` | `24` | Calls per district request. |

Invalid tuning values fall back to defaults. Worker batches cap at 100 and
analysis concurrency at four to bound resource use.

### Dispatch and private scripts

| Variable | Use |
|---|---|
| `BOLNA_API_KEY` | Batch transport and historical execution reads. |
| `BOLNA_AGENT_ID` | Existing Hindi agent for live dispatch. |
| `BOLNA_HINDI_AGENT_ID` | Optional explicit Hindi agent; overrides `BOLNA_AGENT_ID`. |
| `BOLNA_ENGLISH_AGENT_ID` | English agent used for southern-state auto routing or English-only batches. |
| `BOLNA_FROM_NUMBER` | Optional caller-number override. |
| `BACKFILL_AGENT_IDS` | Comma-separated agents for the private backfill script. |
| `BACKFILL_FROM`, `BACKFILL_TO` | UTC ISO date bounds; end defaults to the current time. |
| `DRAIN_URL`, `PROCESS_URL` | Drain-script URL fallback when no positional URL is given. The npm drain/enrich scripts supply localhost URLs explicitly. |

Retry limits come from each event's `max_attempts` column (default eight).
`GOOGLE_REDIRECT_URI`, `ALLOWED_EMAILS`, and `MAX_ATTEMPTS` are not runtime settings.

## Database management

The tracked [database guide](database/README.md) describes fresh setup, adoption,
checksums, rollout order and recovery. For a fresh, empty app schema:

```bash
node --env-file=.env.local database/migrate.mjs --init
```

For an existing installation:

```bash
node --env-file=.env.local database/migrate.mjs
```

The runner locks and applies missing SQL migrations transactionally and records
checksums. It never initializes over existing app tables or touches co-tenant
application tables. Pause old workers/dispatch traffic and let requests finish
before the first reliability rollout; old binaries do not honor leases or
revisions. Apply migrations before deploying the new app. Legacy cookies require
sign-in again, and automatic analysis now needs the separate enrichment schedule.

Private Prisma files remain optional introspection artifacts. Their old push and
post-push scripts are not authoritative for this schema and must not be used to
undo the tracked migrations. Dataset loaders/backfill are separate private tools.

## HTTP interface

“Scoped session” means an active signed-in user with assignment-limited access
when acting as an employee. Admin guards generally return 403 for anonymous and
non-admin requests; ordinary session guards return 401.

| Method | Route | Authorization | Purpose |
|---|---|---|---|
| POST | `/api/bolna-webhook` | Webhook secret; optional IP check | Capture a terminal execution. |
| GET, POST | `/api/process` | Process secret | Claim and process due events. |
| GET, POST | `/api/enrich` | Process secret | Infer eligible missing/stale call analysis. |
| GET, POST | `/api/district` | Process secret | Fill missing inferred districts. |
| GET | `/api/health` | None | Database connectivity and pending/failed event count. |
| GET | `/api/raw/queue` | Admin | Resolve filtered calling candidates and counts. |
| POST | `/api/raw/dispatch` | Admin; `intentKey` and `confirm: true` | Create and schedule per-language batches. UI sends `routingMode`; omission retains legacy Hindi-only behavior. |
| GET | `/api/batches` | Admin | Latest 20 batches, errors and received-result counts. |
| POST | `/api/batches/[id]` | Admin | Check provider status or record a verified resolution. |
| GET, POST | `/api/batches/reconcile` | Process secret | Reconcile five active provider batches per run. |
| POST | `/api/batches/sync` | Admin | Reconcile up to three eligible batches from the visible page; accepts at most 25 batch IDs. |
| GET, POST | `/api/raw/export` | Scoped session | Selected or filtered listing CSV. |
| GET, POST | `/api/calls/export` | Scoped session | Selected/filtered call CSV. |
| PATCH | `/api/calls/[id]` | Scoped session | Retired legacy editing channel; returns 409 for in-scope calls. Use assignment controls. |
| POST | `/api/calls/[id]/enrich` | Scoped session | Manually infer one call. |
| GET | `/api/details/[entity]/[id]` | Scoped session | Entity detail and up to 50 history rows; entity is `call` or `record`. |
| POST | `/api/assignments/preview` | Admin | Allocation eligibility, history, owners and workloads. |
| POST | `/api/assignments` | Admin | Preview-checked, idempotent allocation and durable manual batch. |
| GET, POST | `/api/assignments/[id]/attempts` | Scoped session | Read/log/correct manual attempts with revisions. |
| GET | `/api/details/[entity]/[id]/ai` | Scoped session | Paginated provider attempts with completeness labels. |
| GET | `/api/balance` | Admin | Cached provider wallet, explicit stale/unavailable states. |
| GET | `/api/batches/export`, `/api/batches/[id]/export` | Admin | Complete filtered batch/member CSV. |
| GET | `/api/team/export` | Admin | Date-based metric evidence CSV; the Team page renders summaries directly. |
| PATCH | `/api/assignments/[id]` | Assignee or admin | Edit outcome, remarks, state, `added_to_db`, `wh_id`. |
| DELETE | `/api/assignments/[id]` | Admin | Mark an open assignment dropped; retain history. |
| GET, POST | `/api/users` | Admin | List or upsert accounts. |
| POST | `/api/view-mode` | Current database admin | Switch effective admin/employee view. |
| GET | `/api/auth/google` | None | Begin OAuth. |
| GET | `/api/auth/google/callback` | OAuth state and verified identity | Complete sign-in after account authorization. |
| POST | `/api/auth/logout` | No session required | Clear session and view preference. |

Worker GET requests have the same side effects as POST. Prefer authenticated POST
from schedulers. Process/enrich/district responses include `claimed`, `succeeded`,
and `failed`; process adds per-event results. HTTP 200 can contain failed items,
so inspect counters rather than only the status code.

Calls and raw records use UUIDs. Assignment IDs are numeric identifiers returned
as strings by `pg` for bigint columns.

## Deployment and operations

### Deploy the service

The Git repository contains the app at its root; use `.` as the Vercel project
root. The `bolna-processing` directory name is only for the surrounding local workspace.
The application uses `npm run build` and `npm run start`; for Vercel, set variables
in the project environment configuration.

See [Vercel preview setup](docs/VERCEL_PREVIEW.md) for the review branch, Google
callback and environment settings.

Provision the schema separately, register the deployed Google callback, and
configure both Bolna agents' execution webhooks to send to:

```text
https://<app-host>/api/bolna-webhook?token=<BOLNA_WEBHOOK_SECRET>
```

The header alternative is `x-webhook-secret`. IP enforcement trusts the first
forwarded IP header, so its meaning depends on the deployment's proxy behavior
and expected sender address.

Process and per-call enrichment declare `maxDuration = 60`; bulk enrichment and
district declare `300`. Effective runtime limits depend on host configuration.
Size batches so requests finish within those limits.

### Schedule bounded worker runs

Private `sql/manual/006_cron_enrich.sql` defines a polling design:

| Job | Cadence in the script | Target |
|---|---|---|
| `drain-process` | Every two minutes | `POST /api/process` |
| `enrich-analysis` | Every ten minutes | `POST /api/enrich` |

It uses `pg_cron` and `pg_net`, with `PROCESS_SECRET` in Supabase Vault. Replace
both the deployment URL and secret placeholder for the target environment.
Re-running the create-if-missing secret block does not rotate an existing Vault
secret. Earlier `005_cron.sql` includes a different trigger/backstop design; do
not apply both templates indiscriminately.

Polling keeps capture independent of outbound scheduler HTTP and limits how much
work webhook bursts start. It adds scheduling delay and does not guarantee
two-minute completion during a backlog. Verify scheduler installation and HTTP
delivery independently of application deployment.

Any scheduler capable of authenticated HTTP POST can drive the endpoints. An AWS
scheduled Lambda can issue that request. Historical options in
`aws/eventbridge-scheduler.md` need provider-specific validation before use.

Schedule `/api/batches/reconcile` every five minutes alongside process and enrich.
Run district inference if missing source areas need filling. Overlapping worker
runs are safe through leases and fencing; no cross-request single-runner rule is
required. Scheduling configuration is external and must be installed explicitly.
The source checkout does not establish that any production cron exists. Install
and verify the production job using the [batch polling runbook](database/README.md#background-batch-polling).

### Trigger one processing batch

This example reads local environment configuration without printing the secret.
It processes real due events in whichever database the local app uses:

```bash
node --env-file=.env.local --input-type=module <<'JS'
const response = await fetch('http://localhost:3000/api/process', {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.PROCESS_SECRET}` },
});
console.log(response.status, await response.json());
if (!response.ok) process.exitCode = 1;
JS
```

### Historical backfill and re-inference

With private scripts available, configure `BOLNA_API_KEY`, `BACKFILL_AGENT_IDS`,
and `BACKFILL_FROM`, then run:

```bash
npm run backfill
```

The script reads executions per agent in seven-day windows and pages of 50,
queuing terminal executions. It does not place calls. Duplicate IDs are skipped,
allowing a restart without duplicate event rows.

With the local app running, drain due work:

```bash
npm run drain
npm run enrich
```

The helper stops on `claimed = 0`, meaning **nothing eligible now**, not that all
events completed. Delayed failures, exhausted retries, and abandoned `processing`
rows can remain. Expired claims recover on the next run; delayed and exhausted
jobs require inspecting their lease, attempt and error fields.

After changing inference, update the prompt/schema, persistence mapping, database
schema/view, and readers as needed, then increment `INFERENCE_VERSION`. Run one
enrichment loop or let the configured schedule select stale eligible rows.
`ENABLE_ENRICHMENT=false` stops every analysis endpoint.

### Inspect queue state and failures

These read-only queries distinguish waiting work from work needing repair:

```sql
select status, count(*) as events
from bolna_webhook_events
group by status;

select id, status, attempts, max_attempts, next_attempt_at, last_error
from bolna_webhook_events
where status = 'failed'
order by next_attempt_at;

select id, received_at, attempts, last_error
from bolna_webhook_events
where status = 'processing'
order by received_at;
```

Fix the cause before resetting any exhausted retry budget. Expired leases recover
automatically; `received_at` alone does not identify a stale worker. Job failures
and fingerprints are retained in `bolna_call_jobs`. Health reports pending,
processing, expired and exhausted event counts plus exhausted/expired analysis
jobs; it does not verify provider credentials or complete schema parity.

If Supabase cron is configured, inspect jobs and invocation history:

```sql
select jobname, schedule, active
from cron.job
where jobname in ('drain-process', 'enrich-analysis');

select jobid, status, return_message, start_time, end_time
from cron.job_run_details
order by start_time desc
limit 10;
```

Cron success can mean an asynchronous HTTP request was queued. Check HTTP
responses and application logs as well as SQL invocation results.

### Reconcile an uncertain dispatch

Use Recent batches to check provider status. A recorded provider ID is never
recreated merely because a previous response was lost. Missing IDs can be located
using the local UUID embedded in the upload filename. If automatic verification
cannot prove completion (for example missing retry metadata), verify no remote
calls/retries remain and save an explicit resolution note. The app retains the
actor, outcome and note and releases that batch's reservations. Cancellation must
be performed in Bolna before recording it locally.

### Private dataset maintenance

The intended pipeline is `rawdata/` → cleaner → `cleandata/` → loader → Postgres.
The application does not run it. Private Python tooling uses packages such as
pandas and psycopg2 outside npm dependency management.

The local loader still contains an old absolute project root and legacy
`raw_phones` column references. Adapt and validate it against the current
`phone_id` schema in a disposable database before using it as a reload procedure.
`npm run db:init` is not a substitute for that validation.

## Validation

Framework-independent unit tests cover phone normalization and deduplication,
call categories, CSV generation, batch guard ordering, region routing,
schedule/filename calculation, assignment scope, and autosave ordering and
failure recovery.

```bash
npm test
```

Additional local checks for application changes:

```bash
npm run check
npm run build
```

Run real PostgreSQL regression tests against an explicitly configured disposable
local database after applying the tracked migrations:

```bash
TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:5432/postgres npm run test:integration
```

This suite resets app fixture tables and mocks all OpenAI/Bolna requests. It tests
competing owners/dispatches, transaction rollback, stale claims/results, retry
ordering/backoff, scoped exports, revision conflicts, geography routing, partial
batch success, cross-agent reservations and separate carpet/built-up values. CI rebuilds the schema,
checks replay idempotence, runs unit/integration tests and builds the application.

The adjacent `tests/browser/` harness now uses tracked migrations, current signed
sessions and revision-aware fixtures. `tests/run-stage.mjs` pins all URLs and
provider credentials to the dedicated handoff test container at localhost:55439:

```bash
npm run test:stage -- database
npm run test:stage -- integration
npm run test:stage -- browser
npm run test:stage -- rehearsal
npm run test:stage -- performance final
npm run test:stage -- browser-volume
npm run test:stage -- build
npm run test:stage -- browser-volume-production
npm run test:stage -- browser-production
```

Start that disposable PostgreSQL instance first. Integration/performance/browser
fixtures reset app tables; run those suites sequentially. The browser-volume check
requires the performance fixture without an intervening ordinary test seed. Production
browser modes require a completed build. `reset-database` destroys and rebuilds only
the pinned synthetic handoff schema; it is intended for test-fixture recovery, never
an application migration. Rehearsal creates and drops
separate disposable databases for fresh, legacy and existing-005 upgrades. CI can
use its explicitly configured local `TEST_DATABASE_URL` on port 5432. Never point
these tests at a production tunnel. Do not build while a dev server shares `.next`.
Tests with mocked providers do not validate live credentials or cron installation.

## Current limitations

Remaining operational and domain boundaries:

| Area | Current limit and consequence |
|---|---|
| Provider uncertainty | No distributed transaction or provider idempotency guarantee. Unknown creates remain reserved until verified by an admin. |
| Provider retry metadata | Missing/unknown status or retry exhaustion data prevents automatic release; Recent batches provides audited resolution. |
| Historical attempts | Retained provider IDs establish known attempts; overwritten retries and missing dial timestamps remain unknown. |
| Team timing and onboarding | Durations are staff-reported, active hours are unknown, and onboarding references are not externally verified. See [metric definitions](docs/TEAM_METRICS.md). |
| Wallet units | Defaults to provider units; set a currency label only after checking the account contract. |
| Broader analytics | Global funnel/trends and property-level mismatch aggregates remain the handoff’s v2 scope. |
| Assignment entity FKs | Polymorphic targets are validated and locked by the service; direct SQL deletions can still orphan history. |
| CSV throughput | Streams hold a pool connection; long/stalled downloads or host deadlines can abort. Limit is 100,000 rows per export. |
| Dataset maintenance | Private source cleaners/loaders remain outside the application and need their own validation. |
| Entity matching | Last-ten-digit matching and representative listings do not establish property identity. |
| Language routing | Auto uses the listing state, with other/unknown states defaulting to Hindi. It does not infer the recipient's language preference. |

When extending the system, preserve its boundaries: capture before slow work,
scoped SQL at each access path, human-owned fields outside machine upserts, and
explicit operator confirmation before live dispatch.

Autosave drafts include their expected revision. A conflict keeps the draft for
review; copy any desired text, discard the stale draft, refresh, then apply the
intended change to the current row. Table selection and keyboard/column controls
are scoped to their own grid, and refreshed rows receive current column geometry.

# Bolna Processing

An internal Next.js (App Router) app on Vercel + Supabase Postgres that runs an
AI-calling loop over a warehouse-owner dataset:

1. **Dispatch** — pick records from the master dataset, assemble a calling batch, and
   schedule it on [Bolna](https://bolna.ai).
2. **Capture** — receive Bolna's post-call webhooks and store them durably.
3. **Enrich** — infer property-verification fields from each transcript with OpenAI.
4. **Review** — browse everything in a spreadsheet-like dashboard, joined back to the
   dataset record the call actually reached.

The two halves of the system (calls, dataset) meet at **phone numbers**.

There are two calling channels producing the same fact — the **AI channel** above, and
a **human channel** where an admin assigns dataset records to an employee who dials
them and records the outcome. Admins see and dispatch everything; employees see only
what's assigned to them.

---

## Architecture at a glance

```
                          ┌─────────────────────── Supabase Postgres ───────────────────────┐
                          │                                                                 │
 external listing         │  raw_records ──< raw_phones >── raw_phone_numbers ──< bolna_call_logs
 sources (7)              │   (listing)      (junction)     (canonical number)     (call)    │
      │                   │                                          ▲                       │
      ▼                   │                                          │                       │
 clean_sources.py         │  call_batches / call_batch_items    bolna_webhook_events         │
 load_master.py ──────────▶  (dispatch audit trail)             (landing zone + queue)       │
                          │                                                                 │
                          │  bolna_assignments ─ bolna_app_users   (who owns which item)     │
                          │       ▲                                                          │
                          │  bolna_call_analysis  ← view: segmentation + matched listing     │
                          └────────────────────────── + current assignment ──────────────────┘
                                     ▲                                    ▲
   dashboard (server components) ────┘                                    │
   admin: everything · employee: assigned rows only                       │
        │                                                                 │
        ├── POST /api/assignments ──▶ hand work to an employee (human channel)
        │                                                                 │
        └── POST /api/raw/dispatch ──▶ Bolna /batches + /batches/{id}/schedule
                                                     │
                                        calls happen │
                                                     ▼
            Bolna webhook ──▶ POST /api/bolna-webhook ──▶ INSERT (durability boundary)
                                                     │
            pg_cron (every 2m) ──▶ POST /api/process ─┘  claim → OpenAI → upsert call log
            pg_cron (every 10m) ─▶ POST /api/enrich      backfill/re-infer pass
```

---

## Architectural decisions

Each subsection is a decision plus the reason it was made that way. These are the
things you'd otherwise have to re-derive from the code.

### 1. Capture and processing are separate endpoints

`/api/bolna-webhook` does authentication, schema validation, a terminal-status check,
and one `INSERT` — **no external calls**. `/api/process` does the slow, failure-prone
work (OpenAI, upserts).

The insert into `bolna_webhook_events` is the **durability boundary**: once a row
lands there, the event cannot be lost. A failed enrichment never loses call data —
the row stays queued and is retried. If the insert itself fails we return 5xx so Bolna
redelivers.

Bolna fires a webhook on *every* status change, so non-terminal statuses are
acknowledged with a 200 and dropped rather than queued.

### 2. The queue is a Postgres table, not a broker

`bolna_webhook_events` is both the raw landing zone and the job queue
(`pending | processing | processed | failed`, `attempts`, `next_attempt_at`,
`last_error`). No SQS/Redis/Inngest.

- Workers claim rows in a transaction with `for update skip locked`, so overlapping
  runs never pick the same row.
- Backoff is **per row** (`next_attempt_at = now() + 2^attempts minutes`, capped at
  60), so extra worker runs that find nothing due are cheap no-ops — cadence can be
  as aggressive as you like.
- A partial index on `(next_attempt_at) where status in ('pending','failed')` is
  exactly the worker's due-rows query.
- Failures stop at `max_attempts` (default 8) and are left as `failed` **with the
  error text**, for inspection rather than silent loss.

Rationale: the payload has to be stored in Postgres anyway; a separate broker would
add a second source of truth and a second failure mode for no gain at this volume.

### 3. The worker is driven from inside Supabase (pg_cron + pg_net)

Production polling is `pg_cron` → `pg_net.http_post` → `/api/process` every 2 minutes,
plus `/api/enrich` every 10 minutes. The bearer secret lives in **Supabase Vault**, not
in the SQL body.

- **Polling, not the insert trigger.** An `after insert` trigger on
  `bolna_webhook_events` that kicks the worker was written and deliberately *not*
  applied: it couples DB writes to an outbound HTTP call and amplifies during a
  backfill. 2-minute worst-case latency is acceptable for this workload.
- The worker is a plain authenticated HTTP endpoint, so anything can drive it —
  AWS EventBridge Scheduler / Lambda remain documented alternatives in
  [`aws/eventbridge-scheduler.md`](aws/eventbridge-scheduler.md), and `npm run drain`
  drives it locally.
- Both `POST` and `GET` are accepted on `/api/process` so a dumb scheduler can trigger
  it with a `?token=` query param.

### 4. Everything is idempotent, keyed on Bolna's execution id

The Bolna execution id is the primary key of *both* `bolna_webhook_events` and
`bolna_call_logs`. Re-delivered webhooks, re-runs of the backfill, and re-drains are
all safe.

The `bolna_call_logs` upsert is deliberately **field-selective** on conflict:

- Call facts (`status`, `transcript`, `context_details`, `raw`) always overwrite.
- Inference fields overwrite **only when this run actually inferred**
  (`case when excluded.enriched then … else <existing> end`) — so a re-process without
  enrichment can't wipe a good inference.
- `enriched` is OR-ed and `inference_version` is `greatest(...)` — monotonic, never
  regresses.
- **User-edited workflow columns are never in the upsert at all** (see §14).

### 5. Enrichment is best-effort; storing the call is not

If OpenAI fails (bad key, rate limit, transient error), the worker logs it and stores
the call with `enriched = false`. The call still shows up in the dashboard immediately,
and the row is re-selected later by `/api/enrich` or the per-row "Infer" button.

An LLM outage degrades the product to "calls without inference" instead of stalling the
pipeline.

### 6. Deterministic first, LLM second, then deterministic validation

The house pattern, used in several places:

- **Call classification**: `busy` / `no-answer` → `dead number - do not call`
  deterministically; the LLM verdict is only consulted for calls that actually
  connected. Bolna reports many real conversations as `call-disconnected`, so that
  status counts as connected alongside `completed`.
- **State resolution** in the cleaning pipeline: a curated city→state map runs first,
  OpenAI fills only the gaps, and its answers are **validated against the canonical
  state list** — with the curated map overriding wrong source values.

Keep this ordering when adding new inference.

### 7. Presentation logic lives in a view, not in stored columns

`bolna_call_analysis` computes `availability` and `segment`
(`no_reach`, `followup_hungup`, `followup_silent`, `followup_voicemail`,
`followup_retry`, `followup_other`) at read time from status + hangup reason + the LLM
verdict.

Changing a classification rule re-classifies every historical call instantly, for free,
with no re-processing. The LLM's raw verdict is stored in `llm_availability`; the view
owns the overrides on top of it.

The view is also where `context_details -> 'recipient_data'` is flattened into named
columns, so the dashboard never digs through JSON.

### 8. Inference is versioned and cost-gated

- `INFERENCE_VERSION` in `src/lib/openai.ts` is bumped whenever the prompt or schema
  changes. `where enriched = false or inference_version < $CURRENT` then re-infers
  **only stale rows** — no full re-run, no manual bookkeeping.
- `qualifiesForInference()` gates on connected status **and** `total_cost > 0.04¢`
  **and** a non-empty transcript. Zero-cost calls never rang.
- The gate exists in exactly one place (`src/lib/inference.ts`) and is exported as both
  a TS predicate and a SQL fragment (`NEEDS_INFERENCE_SQL`) so the live path, the bulk
  pass, and the dashboard's `can_enrich` flag can't drift.
- OpenAI is called with a `strict: true` `json_schema` response format, so parsing
  never has to be defensive.
- `confidence = "Low"` sets `needs_review`, which is a first-class dashboard filter —
  low-confidence extractions are surfaced for humans rather than silently trusted.

### 9. Two table namespaces

`bolna_*` = the call pipeline. `raw_*` = the scraped master dataset.
`call_batches` / `call_batch_items` sit between them (dispatch).

Prefixes make ownership obvious in a single shared Supabase database and keep the
`raw_` side droppable/reloadable without touching call history.

### 10. Hybrid dataset schema: fixed columns + JSONB overflow

`raw_records` has one row per **listing**, natural key `(source, source_record_id)`.

- **Promoted to real columns**: only fields that are well-filled across sources *and*
  operationally used — `owner_name`, `warehouse_type`, `listing_status`,
  `area_sqft`, `address`, `city`, `state`, `contact_type`.
- **Everything else lives in `metadata jsonb`**, losslessly, with *harmonized key
  names* across sources (email, title, rent, deposit, pincode, source_url,
  source_created_at, locality, plus all source-native fields).

Adding a source therefore requires no migration. Filtering on metadata uses
`metadata->>'x' ilike …`; there is intentionally **no GIN index** on `metadata` and no
`city` index — both were measured as unused and were costing ~140 MB.

Normalization decisions baked into the loader: areas converted to **sqft** across all
sources, phones canonicalized to `+91` with multi-number cells split, implausible areas
(<100 or >2M) and phone-as-name values nulled — with the original always preserved in
`metadata.*_raw`.

### 11. The phone number is a dimension table, and it's the join spine

```
raw_records ──<(master_id) raw_phones (phone_id)>── raw_phone_numbers ──<(phone_id) bolna_call_logs
```

- A direct `bolna_call_logs → raw_phones` FK is impossible: brokers reuse a number
  across many listings, so the number isn't unique there. `raw_phone_numbers` is the
  unique dimension both sides reference, which makes call↔listing a **real foreign
  key** instead of a join convention.
- `bolna_call_logs.phone_last10` is a **generated column** (last 10 digits of the
  customer's number — caller for inbound, recipient otherwise). Generated columns can't
  carry `ON UPDATE CASCADE`, so the linkage rides on the integer surrogate
  `phone_id`, which the worker resolves (upsert-then-return) *before* inserting the
  call log.
- An empty-string sentinel row exists for calls with no usable number, so the FK is
  `NOT NULL`-clean without special cases.
- Load order is always `raw_phone_numbers` → `raw_phones` (FK direction).

### 12. Broker detection is a computed heuristic, not source-provided

A number appearing on **≥3 listings** marks its records
`contact_type = 'probable broker'`; otherwise the contact is treated as an owner. It's
computed by the loader after load, in a pass that must run with
`statement_timeout = 0` — bulk updates over ~59k rows otherwise hit Supabase's default
timeout.

The name says "probable" on purpose: it's a heuristic surfaced as a filter, not a fact.

### 13. One filter builder per read surface, shared by grid and export

`src/lib/calls.ts` and `src/lib/raw.ts` each own a private `buildFilter()` that both
the paginated grid query and the un-paginated CSV export query call.

The export is defined as "the same thing you're looking at, without pagination" —
sharing the builder makes that true by construction instead of by discipline. Same for
ordering.

Query shapes chosen for this:

- Multi-term search: every whitespace-separated term (max 6) must match at least one
  search column, via substring `ilike` **or** `pg_trgm` `word_similarity > 0.5` on name
  columns for typo tolerance. Similarity is computed **per column**, not over a
  concatenated blob, which would dilute short terms.
- Phone search and existence filters use `EXISTS` subqueries, never joins — a join on
  `raw_phones` would multiply rows.
- The "last call result" filter is a self-contained scalar subquery so the identical
  predicate works in both the `count(*)` and the rows query.
- Matched listings are attached with `LEFT JOIN LATERAL`, so the view stays **one row
  per call** even when a number matches 75+ listings. `raw_match_count` and
  `raw_sources` span *all* matches; the serialized `raw_matches` array is **capped at
  12** to bound egress. The representative listing is chosen deterministically:
  owner over broker, then primary phone, then newest.
- Filter dropdown options come from `unstable_cache`d distinct-value queries
  (10 min revalidate) rather than being recomputed per request.
- Export/queue paths carry explicit safety ceilings (`EXPORT_CAP` 100k, `QUEUE_CAP`
  20k) and the queue endpoint reports `capped: true` rather than silently truncating.

### 14. Dashboard: server-rendered grid, client islands wired by event delegation

Pages are async server components that render a plain HTML `<table>`; interactivity is
added by small `"use client"` components that attach **delegated** listeners rather than
owning the rows.

That's why row checkboxes carry their payload as `data-*` attributes: selection
survives server re-renders (filter/page changes) without hydrating 50 row components.

- **Collapsible column groups** (`GroupToggle.tsx` + `.grp-*` CSS): a green
  header-only toggle column acts as the summary for a set of hidden columns
  ("AI Call Details" → Status; "DB" → Source; raw view's "Calls" → count). They start
  collapsed.
- **Resizable columns** (`ColumnResize.tsx`): injects a `<colgroup>`, switches the
  table to `table-layout: fixed`, persists widths in `localStorage` under
  `sheet-col-widths-vN` (bump `N` to reset everyone). Widths are measured with groups
  **expanded**, otherwise hidden columns would be pinned at 0.
- Search matches are highlighted server-side via `<mark>` using the same term list the
  SQL used.
- **Editable workflow columns** (Call Status / Called By / Added to DB / WH ID) live on
  `bolna_call_logs` but are owned by humans: they PATCH through `/api/calls/[id]`,
  which whitelists field→column mappings with per-field coercion, and the pipeline's
  upsert never touches them (§4). Re-processing a call cannot clobber human work.

### 15. Dispatch never trusts the client

`POST /api/raw/dispatch` receives only **record ids** plus a filter snapshot. It
re-fetches the phone numbers from the database (`getRawQueueRowsByIds`) and re-applies
every guardrail server-side. The client's toggles are hints; the server reconstructs
the callable list.

`assembleBatch()` is a pure function applying a fixed narrowing order:

```
dedup by number → drop excluded call categories → hold back blocked regions
                → skip numbers already in a live batch → require a phone number
```

and it returns a full accounting (`total`, `excludedByCat`, `heldRegion`,
`alreadyQueued`, `skippedNoNumber`, `callable`) so nothing is dropped invisibly — the
counts are shown in the modal, returned by the API, and persisted on the batch row.

`confirm: true` is mandatory: real phones ring, so an accidental POST is a 400.

### 16. Agent selection is a routing layer, never a hardcoded id

The current Bolna agent is Hindi-only, so **Tamil Nadu, Kerala and Karnataka are held
back** from every batch (`isHindiBlocked` in `src/lib/routing.ts`) until an English
agent exists. This is why `state` is a promoted column on `raw_records`.

Held-back rows are *reported*, not silently discarded, and the hold-back applies
regardless of client input. When a second agent is configured, this becomes a
state→agent map — do not inline an agent id at a call site.

### 17. Already-called numbers are flagged, not blocked

`deriveCat()` classifies a record's call history into
`"" (fresh) | dead | unclear | available | unavailable` from its most recent outcome.
The queue modal *warns* with a per-category breakdown and a toggle to purge each
category, rather than deciding for the operator — recalling an "unclear" number is
often exactly what you want, recalling a confirmed "unavailable" usually isn't.

The same function runs on the server (from SQL columns) and in the client (from `data-*`
attributes) so both scopes tag identically. `callCount` is coerced with `Number()`
because `pg` returns `count(*)` as a string, and `"0"` is truthy.

### 18. Every dispatch is persisted before it's sent

`call_batches` + `call_batch_items` are written **first**, with `state = 'sending'`, then
Bolna is called, then the row is flipped to `scheduled` with Bolna's `batch_id` stored
(or `failed` on error, with a 502 returned).

This buys three things:

1. An audit trail that survives a Bolna failure — you always know what was attempted.
2. **Double-call protection**: numbers in a `sending`/`scheduled` batch are excluded
   from new batches. `failed` batches deliberately don't block, so a failed dispatch can
   be retried.
3. Analytics by dispatch time — calls reconcile back through
   `bolna_call_logs.batch_id = call_batches.bolna_batch_id`.

Items are bulk-inserted with a single `unnest(...)` round-trip.

### 19. Bolna's batch API quirks are encapsulated

All in `src/lib/dispatch.ts` / `src/lib/routing.ts`, with unit tests:

- Dispatch is two calls: `POST /batches` (multipart CSV + `agent_id`) then
  `POST /batches/{id}/schedule`. **Creating a batch doesn't call anyone** — scheduling
  does.
- `scheduled_at` must be ISO with a **numeric offset** (a trailing `Z` is rejected), at
  least 2 minutes out, and Bolna rounds up to the next 10-minute mark anyway —
  `computeScheduleAt()` computes the earliest valid "ASAP" slot.
- Bolna names the batch after the uploaded **CSV filename**, so `batchFileName()`
  synthesizes a descriptive one: top-3 cities by frequency + the IST date
  (`Rajkot-Delhi-2026-07-03.csv`). IST is a fixed +5:30 offset with no DST, which keeps
  it deterministic and testable.
- The CSV is written with a UTF-8 BOM and Excel-safe quoting (owners' names contain
  commas and Devanagari), and carries a `retry_config` of 3 retries at 30/60/120
  minutes.
- `from_phone_numbers` is optional (the agent has a default caller ID) and is sent as
  repeated form keys, per FastAPI's `List[str]` convention.

### 20. The database is shared with another application

`prisma db pull` against production revealed a co-tenant app in the same Postgres
schema: `contacts`, `calls` (Exotel), `employees`, `employee_numbers`,
`call_dashboard_whitelist` — **and `assignments`**, which maps a customer phone to a
contact and has nothing to do with this project.

This is why the `bolna_*` / `raw_*` prefixes exist. They are namespacing, not style.
Anything new must be prefixed: a plain `create table if not exists assignments` would
have silently no-opped against the co-tenant's table and failed at runtime against a
schema with none of the expected columns. The assignment tables are therefore
`bolna_app_users` and `bolna_assignments`.

Corollary: never write an unqualified migration here, and never assume a table you
didn't create is yours.

### 21. Work is assigned through one polymorphic table, not a column per entity

Two channels produce the same fact — "does this owner have space?" — the **AI
channel** (Bolna calls) and the **human channel** (an employee dials a listing
themselves). Both are assignable, so assignment lives in one `assignments` table
keyed by `(entity_type, entity_id)` over `'record' | 'call'`.

Why not an `assigned_to` column on each table:

- The same five columns would be duplicated, and "what does X have open?" becomes a
  UNION across both.
- `raw_records` is meant to stay reloadable independent of call history (§9). Its
  `id` is a `gen_random_uuid()` default, so a truncate-and-reload mints new uuids and
  would silently orphan every assignment. Keeping assignment out of that table makes
  the coupling explicit and one-way.

The assignment row is also the **unit of work**: a manually-dialled listing has no
`bolna_call_logs` row, so its `outcome` / `remarks` / `attempts` have nowhere else to
live. Its `outcome` deliberately reuses the LLM's `Available | Unavailable | Unclear`
vocabulary, so human-verified and AI-verified records roll up in one query.

Assignment is **exclusive** — a partial unique index on `(entity_type, entity_id)
where state = 'open'` allows one live owner per entity. Reassigning closes the old
row (`state='dropped'`) and opens a new one, which gives history without a separate
events table. `called_by` (who dialled) stays distinct from `assignee` (who owns the
follow-up).

### 22. Employee scope is one predicate in the shared filter builders

`assignmentScope()` in `src/lib/scope.ts` returns an `EXISTS` predicate — or `null`
for an admin — and both `buildFilter()`s prepend it before any user filter. Because
those builders are already shared with the CSV exports and the queue endpoint (§13),
an employee's export contains exactly the rows their grid shows, with no separate
enforcement to keep in sync. `viewer` is the required first argument of every reader
so a new call site can't silently omit it.

Visibility is **"not dropped"**, not "open": a finished item stays visible so the
employee can review it or untick a mistaken Done. Only an admin unassigning them
makes a row vanish.

On the write path the scope goes *inside* the `UPDATE ... WHERE` rather than a
pre-check — no TOCTOU window, and a non-owner falls through to the existing
`rowCount === 0` → 404. Single-id actions that can't route through a builder
(re-running inference on one call) use `ownsEntity()`.

**Deliberately not Postgres RLS**: the app connects as one pooled role over the
Supabase session pooler, so per-request `set local` is fragile, and every read
already funnels through two builders. The tradeoff is that this only holds while
nobody queries `bolna_call_logs` / `raw_records` outside `lib/calls.ts` and
`lib/raw.ts`.

### 23. The database is the access list, not an env var

`bolna_app_users` decides both **access** and **role**. There is no `ALLOWED_EMAILS`.

```
row + active   -> in, role from the row
row + inactive -> out
no row         -> out
```

Why move it off env: an allowlist in Vercel's environment meant onboarding required a
redeploy, offboarding required a redeploy, and the grant lived in two places that
could disagree (a row could exist for someone the env didn't allow, and vice versa).
Now `/dashboard/team` is the whole mechanism and revocation is immediate.

**Bootstrap.** An empty table would lock everyone out of the page that populates it,
so `ADMIN_EMAILS` admits its addresses as admins — but **only while the table has no
active admin row**. The instant a real admin row exists the variable is inert, so it
can't linger as a second, invisible access path. It logs a warning when it fires.
Keep one address in it as the recovery route for a table with no admins left.

**Fails closed.** The previous version degraded to the env allowlist if the lookup
threw, so a DB blip couldn't lock everyone out. That is no longer coherent — env
isn't the access list — and every page behind the guard needs Postgres to render
anyway. A database error now means "signed out", never "signed in with guessed
permissions".

**Last-admin protection.** Because a row is the only way in, demoting or deactivating
the final active admin would leave nobody able to reach `/api/users` — recoverable
only by hand-editing the database. The endpoint refuses it, on top of the existing
"you can't demote yourself" guard. The bootstrap doesn't rescue this case: it applies
only when there is no admin *row*, and a demoted row still exists.

Access is resolved once per request (React `cache()`), normally in one query.

### 24. Bulk assign reuses the export's contract, with one difference

The Assign button sits beside Export CSV on both grids and follows the same rule —
checked rows win, otherwise the whole filtered set. The difference: export is a GET
navigation, assign is a POST, and for the "all matching" scope it sends the
**filters** rather than ids or a count, so the server re-resolves the row set from
the database. Same rule as dispatch (§15) — the client picks the target, the server
decides the rows.

Already-owned rows are **skipped and reported** unless "reassign" is ticked, mirroring
how the queue modal reports already-queued numbers instead of silently dropping them.

### 25. Session cookies are HMAC-signed; there is no middleware

Google OAuth + an env-var email allowlist. The cookie value is
`<email>.<base64url HMAC-SHA256(email)>`, verified with a constant-time compare.

`httpOnly` stops JavaScript from *reading* a cookie — it does **not** stop a user from
*setting* one, so a plaintext `bp_session=someone@company.com` would otherwise be a
full auth bypass. Signing closes that.

- Guards are explicit at each boundary: pages call `requireUser()` (redirect), API
  routes call `getCurrentUser()` (401). No `middleware.ts` — one fewer place where a
  new route silently escapes protection.
- `getCurrentUser` is wrapped in React `cache()` so a request resolves it once.
- The OAuth `redirect_uri` is **derived from the request** (`x-forwarded-proto/host`),
  so localhost and every Vercel deployment work without per-environment config.
- The flow uses a CSRF `state` cookie and requires `email_verified`.
- `SESSION_SECRET` falls back to `PROCESS_SECRET` / `GOOGLE_CLIENT_SECRET` so the app
  can never end up signing with an empty key; rotating it logs everyone out.

### 26. Pure logic is extracted specifically to be testable

`src/lib/queue.ts`, `dispatch.ts` and `routing.ts` are framework-free — no React, no
`pg` — so the same code runs in the client modal and on the server, and Vitest
(`npm test`, 39 cases) covers dedup, CSV building, classification, batch assembly,
guardrail ordering, filename generation, and the schedule-slot math.

Anything with a phone-dialing or money consequence belongs in one of these modules.

### 27. Postgres access: one pool, Supabase-pooler-specific TLS

`src/lib/db.ts` caches a single `pg.Pool` on `globalThis` across hot serverless
invocations, capped at 6 connections (Supabase's pooler, not this process, handles
concurrency).

The connection string must have `sslmode` / `pgbouncer` / `connection_limit` **stripped**
and be given an explicit `ssl: { rejectUnauthorized: false }` — `sslmode=require` is
otherwise treated as `verify-full` by `node-postgres` and rejects Supabase's
certificate. Every script repeats this; don't "simplify" it away.

DDL prefers `DIRECT_URL` when set; the app uses the **session pooler** URL.

### 28. Prisma owns the schema, applied with `db push`; `sql/` is frozen history

Schema changes go through Prisma. `sql/` is kept only because `load_master.py` still
applies two idempotent files from it — see `sql/README.md`.

The workflow is **`db pull` → edit `prisma/schema.prisma` → `db diff` (review) →
`db push`**, not Prisma Migrate:

```bash
npm run db:pull        # introspect prod into schema.prisma (overwrites it)
npm run db:diff        # review: prints exactly what would change, check for DROPs
npm run db:push        # apply
npm run db:post-push   # <- REQUIRED, see below
```

`db pull` **deletes any model not yet in the database**, so new models are re-added
after pulling, not before.

**`db push` is not the whole story.** Prisma models neither views nor CHECK
constraints, so it silently leaves both out. `bolna_call_analysis` is not optional —
`lib/calls.ts` selects seven assignment columns from it, so until the view is
recreated every Call Analytics query fails. That DDL lives in `prisma/post-push.sql`
and `db:post-push` applies it. `prisma/POST-PUSH-README.md` says the same thing next
to the file, because this is the step that will be forgotten.

`prisma/migrations/` is retained even though push doesn't use it: it is how the eval
harness (§30) builds a local schema from scratch, and `0_init` is a baseline of prod
as it already existed — never run it against production.

Four Prisma-specific traps, all hit and worked around:

1. **`sslmode=require` breaks every command** with a bare `P1001 can't reach database
   server` — misleading, since `pg` connects fine on the same URL. `prisma.config.ts`
   rewrites it to `prefer`; the Supabase pooler requires TLS server-side, so the
   connection is still encrypted. Same tradeoff as `rejectUnauthorized: false` in
   `src/lib/db.ts`.
2. **Prisma can't express the generated column.** `bolna_call_logs.phone_last10` is
   `GENERATED ALWAYS AS (...) STORED`; introspection records it as a `@default` and
   `migrate diff` emits it as a `DEFAULT`, which Postgres rejects. The baseline is
   hand-corrected — regenerating it without re-applying that fix produces a baseline
   that cannot be replayed.
3. **Prisma 7 moved connection URLs out of the schema** into `prisma.config.ts`, and
   dropped `directUrl` — there is only `datasource.url`, so it points at `DIRECT_URL`
   (session pooler, 5432). DDL and Prisma's advisory lock don't work over the
   transaction pooler the app uses at runtime.
4. **Partial indexes need `previewFeatures = ["partialIndexes"]`**, and this schema is
   full of them (the webhook due-rows index, the unenriched-calls index, the exclusive
   assignment constraint). Without the flag every command fails validation.

### 29. Two audiences, two table densities

The admin grids are deliberately Sheets-like — 30px rows, `cursor: cell`, arrow-key
navigation — because an analyst scans and copies. An employee working a call list does
the opposite: reads one row, then types into it. Same data, opposite ergonomics.

So `/dashboard/my` uses `.task-sheet` rather than restyling the shared grid: 48px rows,
form fields with borders, and only the columns that fit a laptop screen (address and
transcript move into tooltips). Editability is visible rather than discoverable — the
employee's four columns are tinted, fenced by a blue rule, and headed with a pencil,
with a one-line legend saying which is which.

Three specific fixes, all found by looking at the harness screenshots:

- **The attempt counter was a bare button** flipping between "log" and "3×" — it
  incremented an opaque number and named nothing. It now says **"No answer"** (the
  event that actually happened) with "N tries · last <date>" as read-only context
  beside it. Incrementing stays server-side so two tabs can't race.
- **Anything that looks disabled must be disabled.** A finished row dimmed its own
  editable cells, and a locked admin switch sat at 55% opacity looking half-on.
  Both now keep full-strength controls; the locked switch shows a padlock and says
  why in its tooltip.
- **Stacked grids fought over height.** Two `flex: 1` sections split the viewport and
  left a dead void between two short tables. Sections are content-height now, and the
  column trim means the horizontal scrollbar that prompted this never appears.

The admin's counterpart is `/dashboard/assignments`: a log, newest first, spanning both
channels and all three states, with headline counts over the whole table rather than the
filtered page. It flags rows where the employee's verdict disagreed with the AI's — for
a manual assignment that comparison comes from the latest AI call on the listing's
number, since such a row has no call of its own.

### 30. The frontend is verified by a separate Playwright harness

`~/dev/bolna-eval` drives the real app in a real browser against a real Postgres and
asserts behaviour **and appearance** — 44 cases across auth/roles, scope, look-and-feel
(computed styles, not pixel snapshots), the assign flow, employee outcome recording,
and team management. It saves named full-page screenshots so the result can be looked
at rather than inferred.

It lives outside this repo deliberately: the app ships without a browser-test
dependency, and the harness can point at any checkout via `APP_DIR`.

Two things make it work:

- **It mints its own session cookie**, reproducing the `<email>.<HMAC>` format from
  `src/lib/auth.ts`, so tests skip Google OAuth. That doubles as a live check on the
  cookie format and lets the negative cases (forged signature, non-allowlisted email)
  be asserted properly.
- **It runs its own database**, because the tests click Assign and tick Done — real
  writes. Schema comes from `prisma/migrations/`, so the view and CHECK constraints
  are present, which is exactly what `db push` leaves out.

The harness bends to the app, never the reverse: its Postgres has TLS enabled because
`src/lib/db.ts` hard-codes `ssl`, rather than weakening `db.ts` for tests and shipping
something different from what was verified.

It has found seven real defects so far — a single-column hub grid, dead vertical space
on My Work, assignment handing out unreachable records, a checkbox that un-ticked itself
while waiting on the server, an AI-verdict comparison that silently never fired for
manual assignments, and two controls that looked disabled while being perfectly usable.
All fixed, each with a regression test.

It also earns its keep on questions a screenshot can't settle: the locked access switch
*looked* half-on, and asserting its computed `transform` and track colour proved the
state was right and only the opacity was wrong — so the fix went to the dimming, not to
the toggle logic.

### 31. The data pipeline and schema are intentionally private

`scripts/`, `sql/`, `rawdata/`, `cleandata/`, `exports/` and `.claude/skills/` are
**gitignored in their entirety** — they reveal which sources are scraped, their schemas,
and owner PII. This README documents the design but names no source.

Consequence: a fresh clone **cannot** build the schema. The live database has all
migrations applied; treat migrations and loaders as local-only artifacts. `db-init.mjs`
applies `sql/*.sql` in sorted filename order (no migration ledger — every file is
written to be idempotent).

---

## Data model

| Table | Grain | Notes |
|---|---|---|
| `bolna_webhook_events` | one Bolna execution | raw payload + queue state (§2) |
| `bolna_call_logs` | one call | call facts + LLM inference + human workflow columns |
| `bolna_call_analysis` | **view**, one row per call | segmentation + matched-listing join (§7, §13) |
| `raw_records` | one listing | fixed columns + `metadata jsonb` (§10) |
| `raw_phones` | listing ↔ number | junction, `is_primary` |
| `raw_phone_numbers` | one unique number | the join spine (§11) |
| `call_batches` | one dispatch | audit trail + double-call protection (§18) |
| `call_batch_items` | one queued number | what was actually sent |
| `bolna_app_users` | one account | **the access list** — role + active flag (§23) |
| `bolna_assignments` | one unit of work | polymorphic over record/call, carries the outcome (§21) |

Cardinalities: listing → phones is 1:N, phone → listings is N:1 (brokers reuse
numbers), number → calls is 1:N.

Scale: ≈58.8k listings across 7 sources, ≈41.6k unique numbers.

---

## Endpoints

| Route | Purpose | Auth |
|---|---|---|
| `POST /api/bolna-webhook` | capture Bolna execution webhooks | `?token=` or `x-webhook-secret` = `BOLNA_WEBHOOK_SECRET` (+ optional IP allowlist) |
| `POST\|GET /api/process` | drain queue, enrich, upsert call logs | `Bearer PROCESS_SECRET` |
| `POST /api/enrich` | bulk / re-inference pass over call logs | `Bearer PROCESS_SECRET` |
| `POST /api/district` | infer district for calls with no source `area` | `Bearer PROCESS_SECRET` |
| `GET /api/health` | DB check + pending count | none |
| `PATCH /api/calls/[id]` | edit workflow columns | session, scoped to own rows |
| `POST /api/calls/[id]/enrich` | re-infer a single call | session, scoped to own rows |
| `GET /api/calls/export` | CSV of the whole filtered call set | session, scoped |
| `GET /api/raw/export` | CSV of the filtered dataset (or an explicit id selection) | session, scoped |
| `POST /api/assignments` | bulk assign records/calls by ids **or** filters | **admin** |
| `PATCH /api/assignments/[id]` | record outcome / remarks / attempts / done | assignee or admin |
| `DELETE /api/assignments/[id]` | unassign | **admin** |
| `GET\|POST /api/users` | list / upsert accounts and roles | **admin** |
| `/dashboard/assignments` | the assignment log — who has what, and what happened | **admin** |
| `GET /api/raw/queue` | all filtered dataset rows with a phone (select-all-across-pages) | **admin** |
| `POST /api/raw/dispatch` | **places live calls** — assemble + schedule a Bolna batch | **admin** + `confirm: true` |
| `/api/auth/google`, `/callback`, `/logout` | OAuth | — |

---

## Setup

```bash
npm install
cp .env.example .env.local     # then fill it in
npm run db:push                # apply schema.prisma to the database (see §28)
npm run db:post-push           # then the view + CHECK constraints Prisma can't model
npm run dev                    # http://localhost:3000
curl localhost:3000/api/health
```

Key env vars (full list with comments in `.env.example`):

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Supabase **session pooler** connection string |
| `DIRECT_URL` | optional, preferred for DDL |
| `BOLNA_WEBHOOK_SECRET` | secret Bolna must send to the webhook |
| `PROCESS_SECRET` | secret the scheduler must send to worker endpoints |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | enrichment (`gpt-4o` default) |
| `ENABLE_ENRICHMENT` | `false` to store calls without inference |
| `PROCESS_BATCH_SIZE`, `ENRICH_BATCH_SIZE`, `ENRICH_CONCURRENCY`, `MAX_ATTEMPTS` | tuning |
| `BOLNA_API_KEY`, `BOLNA_AGENT_ID`, `BOLNA_FROM_NUMBER` | dispatch |
| `GOOGLE_CLIENT_ID/SECRET`, `SESSION_SECRET` | auth |
| `ADMIN_EMAILS` | bootstrap admin only, inert once an admin row exists (§23) |
| `CALLED_BY_OPTIONS` | options for the "Called By" dropdown |

### Deploy

Import the repo in Vercel, set the same env vars, then point Bolna's webhook
(Agent → **Analytics** → *"Push all execution data to webhook"*) at:

```
https://<your-app>.vercel.app/api/bolna-webhook?token=<BOLNA_WEBHOOK_SECRET>
```

Finally apply `sql/manual/006_cron_enrich.sql` in the Supabase SQL editor to schedule
the worker (§3), or use the AWS options in
[`aws/eventbridge-scheduler.md`](aws/eventbridge-scheduler.md).

---

## Operations

**Load / reload the master dataset** (local only):

```bash
python3 scripts/clean_sources.py       # rawdata/* -> cleandata/*
python3 scripts/load_master.py 0       # 0 = all rows; default 50/source
```

**Backfill historical Bolna calls** — set `BOLNA_API_KEY`, `BACKFILL_AGENT_IDS`,
`BACKFILL_FROM` in `.env.local`, then:

```bash
npm run backfill        # queue past executions into bolna_webhook_events
npm run dev             # in one terminal
npm run drain           # in another — loops /api/process until empty
npm run enrich          # loops /api/enrich for anything still un-inferred
```

Both are idempotent and resumable.

**Re-infer after a prompt change** — bump `INFERENCE_VERSION` in
`src/lib/openai.ts`, then run `npm run enrich` (or let the 10-minute cron do it).
Only stale rows are touched.

**Inspect failures:**

```sql
select id, attempts, last_error, next_attempt_at
from bolna_webhook_events where status = 'failed' order by next_attempt_at;

select jobname, schedule, active from cron.job;
select * from cron.job_run_details order by start_time desc limit 10;
```

**Change what the LLM extracts** — edit the prompt and `json_schema` in
`src/lib/openai.ts`, add the columns, extend `inferenceFields()` and the
`bolna_call_analysis` view, then bump `INFERENCE_VERSION`.

---

## Known gaps

- **The assignment migration has not been applied to production.** `npm run db:diff`
  shows exactly what it would add (two tables, additive, no DROP). Applying it takes
  two commands, and the baseline must be marked applied FIRST or Prisma will try to
  create the 13 tables that already exist:

  ```bash
  npx prisma migrate resolve --applied 0_init   # records the baseline; creates _prisma_migrations
  npm run db:migrate                            # applies the assignment migration
  ```

  Both write to production, so they're left for you to run.
- **Owner-level rollup** (grouping listings by phone) and **cross-source dedup**
  (~1,605 within-source duplicate listings) are known and deliberately deferred.
- **English-agent routing** isn't built — three states are simply held back (§16).
- A few comments in `QueueForCalling.tsx` still describe dispatch as a stub; it is live.

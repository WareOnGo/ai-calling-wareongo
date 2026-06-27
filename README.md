# Bolna Processing

Receives Bolna **post-call webhooks**, enriches each ended call with **OpenAI**,
and stores the result in **Supabase Postgres**. Built as a Next.js app for Vercel.

## How it works

```
Bolna POST ─▶ /api/bolna-webhook   verify → validate → keep only ended calls
                                    → INSERT raw row (status='pending') → 200
                                      (no external calls here — fast & reliable)

AWS cron  ─▶ POST /api/process      claim due rows → OpenAI enrich → upsert call_logs
  (every 1m)                        success → 'processed'
                                    failure → attempts++, back off, retry next run
```

**Why two parts?** Catching the data must be instant and reliable; processing is
slow and can fail. Splitting them means a failed enrichment never loses call data
— the row stays in `webhook_events` and is retried automatically.

### Tables
- `webhook_events` — raw landing zone **and** the job queue (status, attempts, backoff).
- `call_logs` — cleaned + OpenAI-enriched output.

The insert into `webhook_events` is the durability boundary: once a row is there,
the event cannot be lost.

## Setup

### 1. Install
```bash
npm install
```

### 2. Environment
Copy `.env.example` to `.env.local` and fill in:
- `DATABASE_URL` — Supabase **Session pooler** connection string
  (Dashboard → Project Settings → Database → Connection string → *Session pooler*).
- `BOLNA_WEBHOOK_SECRET` — secret Bolna must send (generate: `openssl rand -hex 16`).
- `PROCESS_SECRET` — secret your AWS scheduler must send.
- `OPENAI_API_KEY` — your OpenAI key. `OPENAI_MODEL` defaults to `gpt-4o-mini`.

### 3. Create the tables
```bash
npm run db:init        # applies sql/001_init.sql
# or paste sql/001_init.sql into the Supabase SQL editor
```

### 4. Run locally
```bash
npm run dev
# health check:
curl localhost:3000/api/health
```

### 5. Deploy to Vercel
Push to a repo, import in Vercel, add the same env vars in Project Settings.
Then set the Bolna webhook URL (Agent → **Analytics tab** →
*"Push all execution data to webhook"*):

```
https://<your-app>.vercel.app/api/bolna-webhook?token=<BOLNA_WEBHOOK_SECRET>
```

> Tip: point it at https://webhook.site first to inspect a real payload.

### 6. Schedule the worker
See [`aws/eventbridge-scheduler.md`](aws/eventbridge-scheduler.md). In short, have
AWS POST to `/api/process` every minute with `Authorization: Bearer <PROCESS_SECRET>`.

## One-time backfill of past calls

Pulls historical executions from Bolna and runs them through the same pipeline.

1. Fill these in `.env.local`:
   - `BOLNA_API_KEY` — your Bolna API key (bearer).
   - `BACKFILL_AGENT_IDS` — comma-separated agent IDs (the list endpoint is per-agent).
   - `BACKFILL_FROM` — how far back, UTC ISO 8601 (e.g. `2025-01-01T00:00:00.000Z`).
   - `OPENAI_API_KEY` — needed for the enrichment step.
2. Queue the past executions (fetches Bolna `/v2/agent/{id}/executions`, paginated,
   in 7-day windows, inserts terminal calls into `webhook_events`):
   ```bash
   npm run backfill
   ```
3. Process the queue (enrich + write to `call_logs`). Start the app, then drain:
   ```bash
   npm run dev          # in one terminal
   npm run drain        # in another — loops /api/process until empty
   ```

Everything is idempotent: re-running the backfill or drain is safe (no duplicates).

## Customizing the enrichment

Edit `src/lib/openai.ts` — change the system prompt and the `json_schema` to
produce whatever fields you need, then add matching columns to `call_logs`
(`sql/001_init.sql`) and to the insert in `src/app/api/process/route.ts`.

## Endpoints
| Route | Purpose | Auth |
|---|---|---|
| `POST /api/bolna-webhook` | Receive Bolna execution webhooks | `?token=` or `x-webhook-secret` header = `BOLNA_WEBHOOK_SECRET` |
| `POST /api/process` | Drain + enrich pending events | `Authorization: Bearer <PROCESS_SECRET>` |
| `GET /api/health` | DB check + pending count | none |

## Operational notes
- **Idempotent everywhere.** Re-delivered webhooks and re-run jobs are safe
  (upserts keyed on the execution id).
- **Retries.** Failed events back off exponentially (2^attempts minutes, capped
  at 60) and stop at `max_attempts` (default 8), left as `failed` for inspection.
- **Batch size.** `PROCESS_BATCH_SIZE` (default 5). Keep it small on Vercel Hobby
  (short function time limit); raise on Pro.
- **Inspect failures:**
  ```sql
  select id, attempts, last_error, next_attempt_at
  from webhook_events where status = 'failed' order by next_attempt_at;
  ```

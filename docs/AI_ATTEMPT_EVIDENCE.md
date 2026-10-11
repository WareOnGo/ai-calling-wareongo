# AI attempt history contract

`bolna_ai_attempts` stores one merged row per execution and identifiable provider call ID. Repeated deliveries update that row; different provider IDs remain separate dials. Sparse updates preserve known fields and older deliveries cannot rewind newer evidence. Its `raw` column is the accepted merge. The webhook inbox feeds the worker the accepted merged snapshot for that exact dial, including retained nonterminal metadata. Missing dial identity falls back to the incoming payload. There is no duplicate delivery ledger.

Telephony and batch-run metadata merge their individual fields, retaining known retry counts when later metadata omits or nulls them. Contact identity is derived from the accepted merged numbers and direction: an inbound call stays linked to its caller when a partial update repeats only the destination, and a direction correction uses retained numbers.

Missing IDs, overwritten retries and unlogged calls cannot be reconstructed from totals. Inbound, outbound and confirmed conversations are separate. A confirmed conversation requires `completed` status, positive conversation duration and caller speech, and excludes voicemail. `call-disconnected` is final for batch processing and still counts as a dial, but does not satisfy this conversation rule. Balance-low remains diagnosable but is excluded from default Calls and Raw calling-history fields/filters.

## Time policy

Store UTC and display IST consistently. The application interprets timezone-less provider values as UTC; explicit offsets retain their actual instant. Parsing does not depend on the Node or PostgreSQL session timezone. This is the agreed application convention, not provider-timezone verification: check one known call before production acceptance. Invalid and missing times remain unknown.

Intervals compare dated attempts for the same phone and direction, including across pages and midnight. The UI formats seconds as days, hours, minutes and seconds. Calls, Raw and the timeline all use IST display.

## Reconciliation and migration recovery

Webhooks and reconciliation share tolerant optional duration/retry validation: number, string and null variants are accepted; required fields still validate.

Reconciliation saves a deterministic snapshot fingerprint and offset on the batch. It commits each 250-execution page with the cursor and processes at most four pages per invocation. Reordered snapshots keep the same fingerprint. A changed snapshot resets the cursor and replays idempotent per-dial upserts. Reservations are released only after every page and completion check succeeds.

A two-minute renewable lease fences concurrent checks. A hard-killed worker leaves its committed cursor and a lease that expires; the next check resumes. Updating the batch's scheduling timestamp at claim/page boundaries lets other batches advance in cron. The provider API still returns its full snapshot; the cursor bounds database work, not provider response size.

Migration 007 independently recovers retained call/inbox payloads in cursor-based 250-row transactions, after schema 006 has committed. It records completion only after both sources finish. This path preserves identities actually retained; it cannot recreate overwritten provider history.

# AI attempt history contract

`bolna_ai_attempts` stores one merged row per execution and identifiable provider call ID. Repeated deliveries update that row; different provider call IDs remain separate dials. Sparse updates preserve known fields and older deliveries cannot rewind newer evidence. The `raw` column is the accepted merge, not an original delivery. Migration 018 removes the redundant immutable delivery ledger and its deletion restriction. The terminal webhook inbox still retains its latest accepted original payload per execution for processing/replay.

No ID means no verified dial count. Legacy counters, overwritten retries and missing provider identities cannot reconstruct lost calls. Inbound calls, outbound attempts and confirmed conversations are separate measures. Confirmation requires finalized duration and caller speech evidence, not a completed status alone. Balance-low records are retained for diagnosis but excluded from default call history and Raw's Last Called, Last Status and Already called logic.

## Dial times and intervals

- Zoned timestamps use absolute time and display in IST.
- Unqualified timestamps display the provider's original value, labelled **timezone not supplied**. They are ordered as calendar timestamps; compatible consecutive values produce a provider-clock interval, including across midnight.
- Intervals compare only the same phone, direction and clock basis; local-clock values additionally require the same provider. Zoned and local values are never subtracted from each other.
- This does not assert that an unqualified time is UTC or IST. A read-only sample found no supplied timezone in 20,000 stored payloads; the new interval path explicitly covers that shape. Provider timezone confirmation remains a staging acceptance check.

## Ingestion and recovery

Webhooks and batch reconciliation share the optional duration/retry schema: number, string and null variants are accepted. Required fields still validate. An unrecognized optional value cannot fabricate a duration or retry count.

Reconciliation writes at most 250 execution payloads per transaction. A later failure preserves earlier commits; replay merges those dials without duplication. Calling reservations remain until every page succeeds and provider completion checks pass. The 501-execution regression interrupts the second page, verifies the first page and reservations, then successfully replays.

Migration 015 recovers retained call/inbox payloads in cursor-based 250-row transactions. Its functions use `CREATE OR REPLACE`, so a real runner retry after a committed schema change is safe. Recovery is limited to retained identities. Compare representative retry chains against provider call history before production acceptance.

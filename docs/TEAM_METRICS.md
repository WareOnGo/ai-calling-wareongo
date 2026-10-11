# Team reporting contract

The admin Team page builds only the five requested measures and their dependencies. It does not execute all diagnostic metrics behind the default table. Selecting a metric loads its evidence; CSV uses the same relation. The unused JSON report endpoint has been removed. Inactive callers remain in historical summaries.

| Default measure | Definition |
| --- | --- |
| Recorded calls | Effective explicit manual attempts in the selected period; corrections replace superseded events. Note edits and legacy counters are excluded. |
| Connect rate | Connected, callback or awaiting-confirmation attempts divided by recorded attempts. Unlogged historical calls remain unknown. |
| First Available targets | First supported Available verification per caller and listing/execution. Shared phones do not merge properties. Later reference entry does not move the discovery date. |
| Onboarded references | First supported staff onboarding per trimmed warehouse reference across callers, credited to its recorded owner. Reused references are flagged for review. |
| Average call duration | Mean self-reported seconds on connected attempts with duration; timed/connected coverage is shown. Missing durations are excluded; a reported zero remains zero. No active-time or calls-per-second measure. |

## Dates and legacy references

From/To are inclusive India calendar dates, queried from From 00:00 IST through the start of the day after To. Backdated attempts use their occurrence time. Undated verification is disclosed separately and never assigned a fabricated date by a later note edit.

New/changed warehouse IDs must be positive integer strings, 1–100 digits with no leading zero. Historical non-placeholder references such as `WH-123` remain included in historical onboarding, completion counts and the Onboarded filter. They also appear in reference-quality review. Format validation does not verify external warehouse existence.

Migration 018 copies legacy call-row Added/WH values only to the latest exact call assignment when safe: it does not replace a conflicting reference or a prior manual verification. Imported verification remains undated. Unmatched and conflicting original values remain visible on Calls and in separate CSV columns; no caller attribution is invented.

## Optional evidence views

Explicit metric links/parameters retain workload, first completion, repeat Available, due work, reopened targets, reference quality, legacy activity and exact-execution AI/manual comparison diagnostics. Each request builds only its required query branches. Workload/quality/due views describe the present, not a past workload snapshot. Valid historical completions use retained `completed_at`; repeated Done/reopen cycles do not create a second first completion for the same caller/target.

Evidence pages contain 50 rows. CSV exports are capped at 100,000 rows. Broader funnel charts, source/city trends and aggregate property-level disagreement reporting remain v2.

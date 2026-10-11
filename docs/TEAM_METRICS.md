# Team reporting contract

Team supports exactly five measures. Summary, evidence and CSV share the same query relation; selecting a metric loads only its evidence dependencies. Other metric selectors are rejected, and their query branches have been removed. Inactive callers remain in historical summaries.

| Measure | Definition |
| --- | --- |
| Recorded calls | Effective explicit manual attempts in the selected period. Corrections replace superseded events; notes edits and legacy counters do not count. |
| Connect rate | Connected, callback and awaiting-confirmation attempts divided by recorded attempts. Historical unlogged calls are unknown. |
| First Available targets | First supported Available verification per caller and listing/execution. Shared phones do not merge properties; later reference edits do not move the discovery date. |
| Onboarded references | First supported staff onboarding per trimmed reference across callers, credited to its recorded owner. |
| Average duration | Mean self-reported seconds on connected attempts with known duration, with timed/connected coverage. Missing durations are excluded and zero remains zero. |

Dates include complete IST calendar days. Backdated attempts use their occurrence time. Undated legacy verification receives no invented reporting date from a later note edit. Evidence pages hold 50 rows; CSV exports are capped at 100,000 rows.

Available evidence from a logged call comes only from its effective, corrected event. Assignment snapshots of that result are projections, so correcting a mistaken Available attempt removes its credit from the summary, evidence and CSV. An independently recorded dropdown discovery remains separate evidence. Query dependencies are explicit typed lists, rather than inferred from SQL text.

Correcting the latest call with an explicit result also updates the assignment when its current result came from an older attempt. Independently selected dropdown results remain intact. Corrections to older calls do not overwrite a newer call's explicit result.

New or changed warehouse IDs must be positive integer strings, 1–100 digits without a leading zero. Historical non-placeholder references remain visible and count when dated evidence supports them. Relevant edits to a Done Available row require a valid integer reference; an operator can repair the reference or reopen the row. Format validation does not verify external warehouse existence.

The schema stage copies legacy call-row Added/WH data only to the latest exact assignment when safe, without replacing conflicting or manually verified values. Imported verification stays undated. Unmatched/conflicting original values remain separately visible and exported.

Completion quality, current workload and follow-ups remain in their existing operational views. Extra Team diagnostics and broader charts are outside the five-measure report.

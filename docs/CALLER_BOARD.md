# Caller board plan

The caller board replaces My Work with a seven-stage Kanban for callers, plus a
per-caller funnel for admins. Status as of 5 November 2026: scope agreed,
migration 019 written and rehearsed, nothing deployed.

Sources: [PRD and interaction spec](https://claude.ai/artifact/UWzEVdSFT5GBVkB9Cn3pZk)
and [prototype](https://claude.ai/artifact/5uDWaaY3rnp4LpK5DFW9n4) (board and admin funnel).
Branch: `codex/bolna-visual-overhaul`, fast-forwarded to `main` at `658b703`.

## Stages

| Column | Slug | Meaning | Ends the task? |
| --- | --- | --- | --- |
| 1 Inbound | `inbound` | New or not yet worked | No |
| 2A RnR | `rnr` | Rang, no response | No |
| 2B Rejected | `rejected` | Owner unavailable or said no | Yes |
| 2C Awaiting details | `awaiting_details` | Available, details still to come | No |
| 3 Details collected | `details_collected` | Size, rent, specs captured | No |
| 4 Warehouse ID | `warehouse_created` | Listed in the warehouse DB | Yes |
| 5 Junk | `junk` | Wrong or invalid number | Yes |

Moving a card into 2B, 4 or 5 marks the task Done behind the scenes, so the Team
report keeps working. Done is not shown as its own concept on the board.

## Decisions

| Topic | Decision |
| --- | --- |
| Card | One card per phone. Allocation already keeps one caller per phone; the board groups the 36 phones that have several open listings with the same caller. |
| My Work | The board replaces it, including the classic employee screen kept on `main`. |
| What the board shows | Open tasks in every column, plus finished tasks only in 2B, 4 and 5. Finished tasks in 1, 2A, 2C or 3 (748 at backfill: mostly agent/broker/duplicate in 1, closed Unclear in 2A, closed Available without a warehouse ID in 2C/3) count only in the funnel. |
| Comments | Use the existing `remarks` field. Its edit history is already in `bolna_assignment_changes`. |
| Tasks | Dropped. The follow-up date (`next_due_at`) covers "call back on date X". |
| Last updated | New `updated_at` column, kept current by a trigger. |
| Call batch filter | Assignment batch (`bolna_assignment_batches`), with a "No batch" option. |
| Callyzer | Admin visibility only. Not a source for strikes. |
| Out of MVP | Call now, Request AI follow-up and the Table tab. |
| Deferred | Priority (P0/P1/P2) and secondary assignee. Reassignment covers handoffs for now. |

Defaults taken where nobody objected: phone numbers stay fully visible (no masking);
filters are multi-select through the existing `MultiSelect`; cards are ordered by
overdue follow-up first, then follow-up date, then last updated; a reason is
required when moving to Junk and optional for 2B; nothing in 2B or Junk is deleted.

## Backfill of existing tasks

Production callers record work only in the result dropdown and remarks. Call
status, closure reason, follow-up date and logged manual calls are each set on
about two tasks, so they are ignored. Rules, in order:

1. Valid warehouse ID or Added ticked → 4.
2. Remarks say agent, broker, repeated number or duplicate → 1 (held for review).
3. Remarks say wrong number, invalid or doesn't exist → 5.
4. Result Unavailable → 2B.
5. Result Available → 3 if remarks carry size/rent, else 2C.
6. Result Unclear → 2C if remarks say call back / will share, else 2A. This includes finished Unclear tasks.
7. No result → by remark keywords (RnR, call back, rejected, details), else 1.

Read-only dry run on production, 5 November 2026:

| Stage | Open | Done |
| --- | ---: | ---: |
| 1 Inbound | 485 | 212 |
| 2A RnR | 340 | 204 |
| 2B Rejected | 14 | 1,038 |
| 2C Awaiting details | 131 | 106 |
| 3 Details collected | 59 | 226 |
| 4 Warehouse ID | 23 | 359 |
| 5 Junk | 6 | 125 |

Other production facts that shape the build: 7 callers, median 114 open tasks,
max 433; 612 of 1,058 open tasks came through an assignment batch (40 batches);
Callyzer tracks 2 of 9 active users; `bolna_assignment_quality_guard` and
`bolna_assignment_contacts_sync` are disabled in production, so the app must
enforce ownership and completion rules itself.

## Build steps

- [x] **0. Scope and branch.** Decisions above; branch fast-forwarded to `main`.
- [x] **1. Migration 019** (`database/migrations/019_caller_board_stages.sql`): `stage`, `updated_at`, touch trigger, board index, backfill. Rehearsed locally; see `database/README.md`.
- [ ] **1b. Apply 019 to production.** `npm run db:migrate` applies only 019. Needs explicit go-ahead.
- [ ] **2. Board read layer** (`src/lib/board.ts`). Tasks per stage for the viewer through `assignmentScope` (callers see their own, admins see all with an assignee filter). Group by phone. Per-column paging ("load more", 50 cards). Stage counts for the strip. Filters: city, state, assigned by, assignment batch, last updated (24 h / 7 d / 30 d), assignee (admins only).
- [ ] **3. Board UI.** Built at a new route during development, then swapped in for `/dashboard/my`. Columns with code and color, count strip, cards (owner, city, phone, warehouse badge with ID count from `warehouseIds`, follow-up date with an overdue state, assignee).
- [ ] **4. Drawer and stage moves.** One write endpoint with a revision check. Writing `stage` is audited by the existing trigger. 2B/4/5 set `state='done'` and `completed_at`; moving out of them reopens the task after an app-side ownership check. Junk requires a reason (stored in `disposition`). Drawer shows the timeline (stage changes and remark edits from the audit table, AI calls, manual calls; Callyzer for admins), remarks, follow-up date and stage buttons. Board completions need a quality-guard exception like 018's for databases where the guard is enabled (migration 020).
- [ ] **5. Drag and drop.** Native HTML5 drag between columns, calling the same endpoint. The drawer's stage buttons are the keyboard alternative.
- [ ] **6. Strikes and Junk digest.** Five strikes proposes Junk; nothing moves without confirmation. Strike definition and digest delivery to be decided here.
- [ ] **7. Admin funnel.** Rows per caller, stage columns, leads, % reaching 4, warehouse IDs per caller; filters that change the numbers.
- [ ] **8. Retire My Work.** Remove `src/app/dashboard/my/classic`, `employee-work*.ts`, `/api/my-work`, and update browser tests.

## Open decisions

| Decision | When | Note |
| --- | --- | --- |
| What counts as a strike, and how is the digest sent? | Step 6 | Callyzer can't be the source. |
| Does Stage 4 happen automatically when a warehouse ID appears? | Step 4 | Warehouse sync runs hourly, so an automatic move can lag up to an hour. |
| Can a secondary assignee move stages? | When secondary assignee is picked up | Deferred with the feature. |

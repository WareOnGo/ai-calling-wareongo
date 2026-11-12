# Caller board plan

The caller board replaces My Work with a seven-stage Kanban for callers, plus a
per-caller funnel for admins. Status as of 5 November 2026: steps 0–7 are built
on `codex/bolna-visual-overhaul` at `/dashboard/board` and `/dashboard/board/funnel`,
alongside My Work. Its tab reads "Board" with a Beta tag while both views run side by side.
Migrations 019, 020 and 021 are applied to production and are on main. Nothing else is
deployed or merged.

Sources: [PRD and interaction spec](https://claude.ai/artifact/UWzEVdSFT5GBVkB9Cn3pZk)
and [prototype](https://claude.ai/artifact/5uDWaaY3rnp4LpK5DFW9n4) (board and admin funnel).

## Stages

| Column | Slug | Meaning | Ends the task? | Result recorded on move |
| --- | --- | --- | --- | --- |
| 1 Inbound | `inbound` | New or not yet worked | No | unchanged |
| 2A RnR | `rnr` | Rang, no response | No | Unclear |
| 2B Rejected | `rejected` | Owner unavailable or said no | Yes | Unavailable |
| 2C Awaiting details | `awaiting_details` | Available, details still to come | No | Available |
| 3 Details collected | `details_collected` | Size, rent, specs captured | No | Available |
| 4 Warehouse ID | `warehouse_created` | Listed in the warehouse DB | Yes | Available, Added ticked |
| 5 Junk | `junk` | Wrong number or no response after repeated tries | Yes | unchanged |

Moving a card into 2B, 4 or 5 marks its tasks Done, so the Team report keeps
working. Moving finished work back to 1, 2A, 2C or 3 reopens it, unless the phone
has a warehouse in the DB or open work with another caller.

## Decisions

| Topic | Decision |
| --- | --- |
| Whose work | Own work by default, for admins too. Admins can select an active team member with **View work as**; normal edit controls are available immediately. The first change to each card asks for confirmation; later changes to that entry do not prompt again. Cards, counts, filters and history retain employee visibility. Write APIs require an admin for another employee's scope and bind every task to that assignee, while recording the signed-in admin as the actor. The Funnel remains the admin overview. |
| Card | One card per caller and phone. It sits in the stage of its most recently worked open task (or latest task, if all are finished). Allocation already keeps one caller per phone. |
| What the board shows | Open tasks in every column, plus finished tasks only in 2B, 4 and 5. Finished tasks in other stages count only in the funnel. |
| Moving a card | Moves its open tasks, or every task of a finished card, all or nothing, checking each task's revision first. |
| My Work | The board replaces it, including the classic employee screen kept on `main` (step 8). |
| Comments | Each task's existing `remarks` field, edited in the panel. Earlier versions appear in the timeline from the audit table. |
| Tasks | Dropped. The follow-up date covers "call back on date X"; a chosen day is due at 10:00 IST. |
| Reasons | Junk needs one: wrong or invalid number, or no response after repeated tries. Rejected may take one: leased out, or no property for rent. Both reuse the call vocabulary. |
| Stage 4 | Needs a positive integer warehouse ID, prefilled when the phone matches exactly one warehouse. |
| Strike | An IST day with at least one unanswered call (no answer, busy, switched off, owner unresponsive) on any of the card's tasks. Entering RnR logs one; "Log a no-answer call" logs more; repeats on one day count once. |
| Junk proposal | Five strikes, unless the card is finished or has a future follow-up date ("keep trying"). Nothing moves automatically. |
| Digest | An in-app banner and review dialog, scoped like the board. No email or message is sent. |
| Callyzer | Admin visibility only; not used for strikes. |
| Funnel | Leads are board cards, including finished work in every stage. A warehouse ID is credited to the caller whose card reached stage 4, and counted once in totals. |
| Call batch filter | Assignment batch (`bolna_assignment_batches`), with a "No batch" option. |
| Out of MVP | Call now, Request AI follow-up and the Table tab. |
| Deferred | Priority (P0/P1/P2) and secondary assignee. Reassignment covers handoffs for now. |

Defaults taken where nobody objected: phone numbers stay fully visible; filters
are multi-select; cards are ordered overdue first, then follow-up date, then last
updated; nothing in 2B or Junk is deleted.

## Backfill of existing tasks

Production callers record work only in the result dropdown and remarks, so the
019 backfill uses those. Rules, in order:

1. Valid warehouse ID or Added ticked → 4.
2. Remarks say agent, broker, repeated number or duplicate → 1 (held for review).
3. Remarks say wrong number, invalid or doesn't exist → 5.
4. Result Unavailable → 2B.
5. Result Available → 3 if remarks carry size/rent, else 2C.
6. Result Unclear → 2C if remarks say call back / will share, else 2A, including finished Unclear tasks.
7. No result → by remark keywords, else 1.

Open tasks after the production backfill on 5 November 2026: 484 Inbound, 339 RnR,
14 Rejected, 131 Awaiting details, 59 Details collected, 25 Warehouse ID, 6 Junk.
Of the finished tasks outside 2B, 4 and 5, 314 were closed as Available without a
warehouse ID; they are hidden from the board and appear only in the funnel.

## Build steps

- [x] **0. Scope and branch.** Branch fast-forwarded to `main` at `658b703`.
- [x] **1. Migration 019:** `stage`, `updated_at`, touch trigger, board index, backfill. Applied to production on 5 November 2026 at 19:22 IST.
- [x] **2. Read model** (`src/lib/board.ts`): cards, column totals and paging, filters, scope.
- [x] **3. Board page** (`/dashboard/board`): columns, count strip, cards, filters, loading state.
  Each column pages on its own: it shows 50 cards, and reaching the end of its list (by scrolling or keyboard focus) loads 50 more in place, up to 500. The column sizes live in the URL (`inbound_cards=100`) and the URL is replaced, not pushed, so Back leaves the board. Columns that reach their end together merge into one request. At 500 the column says to search or filter for the rest.
- [x] **4. Panel and moves:** stage buttons, reason and warehouse-ID steps, notes, follow-up, timeline; `/api/board/{move,tasks/[id],follow-up,timeline}`; migration 020.
- [x] **5. Drag and drop**, with the panel's buttons as the keyboard path.
- [x] **6. Strikes and Junk review:** strike dots, `/api/board/no-answer`, banner and review dialog.
- [x] **7. Admin funnel** (`/dashboard/board/funnel`).
- [x] **Admin employee perspective.** The `employee` URL parameter is resolved on the server for admins only. Filters, saved views, refresh and column paging retain the selected person; switching people resets column sizes and closes the panel. The first save, drag move or Junk decision for each entry asks for confirmation. That confirmation covers its listing and AI tasks, stage changes, notes, follow-ups, warehouse details and call logging. Other entries require their own confirmation. Filters, in-app refresh and reopening the same card retain it; switching employees or reloading resets it. There is no global edit toggle. Unsaved admin notes block navigation; conflicts preserve the draft until discarded and reloaded. Writes retain assignment ownership, revision checks, warehouse guards and the admin's audit identity. Manual/Callyzer history stays hidden just as it is for the employee. Selecting **My work (me)** restores the admin's own board.
- [x] **Apply 020 to production.** Applied 5 November 2026, 21:21 IST, from main `8a03fbd`; see `database/README.md`.
- [x] **Migration 021: My Work keeps the stage in step.** While both views run, a non-board write (My Work, admin edits, logged calls) re-places a task with 019's inference when its result or warehouse changes, or when a task still in Inbound gets notes or is finished. Notes-only edits and completing a task past Inbound keep the column chosen on the board. A one-off catch-up re-placed 36 tasks the board never moved. Applied 6 November 2026, 15:04 IST, from main `c67e515`; see main's `database/README.md`.
- [ ] **8. Retire My Work:** point employees at the board, then remove `src/app/dashboard/my/classic`, `employee-work*.ts`, `/api/my-work` and their browser tests.

## Tests

| Layer | Files |
| --- | --- |
| Unit | `src/lib/board-stages.test.ts`, `board-filters.test.ts`, `board.test.ts`, `board-timeline.test.ts`, `board-funnel.test.ts` |
| Integration (PostgreSQL) | `tests/integration/caller-board.test.ts`, `caller-board-moves.test.ts`, `caller-board-strikes.test.ts`, `caller-board-funnel.test.ts`, `caller-board-stage-sync.test.ts` |
| Browser | `tests/browser/tests/45-caller-board` to `51-board-employee-edit` specs: scope, grouping, filters, paging, moves, drag and drop, strikes, funnel, employee perspectives and confirmed editing, keyboard and focus, contrast and overflow at 1366 and 390 px in both themes |

## Open decisions

| Decision | Note |
| --- | --- |
| Should Stage 4 happen automatically when warehouse sync finds a new warehouse for a card's phone? | Not built. Sync runs hourly, so an automatic move can lag up to an hour. |
| Should the digest also reach callers outside the app? | Needs a messaging channel; the in-app banner is all that exists. |
| Should the 314 closed-Available leads without a warehouse ID reappear on the board? | One condition in `boardWhere`. |
| Can a secondary assignee move stages? | Deferred with the feature. |

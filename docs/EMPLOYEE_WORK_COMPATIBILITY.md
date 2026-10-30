# Preserved employee workflow

The selective merge of `707f797` into main keeps the `/dashboard/my` task screen
from `432fe9f`. The shared CallOnGo menu and navbar use the new design. Admin
records, assignment allocation, batches, Callyzer reports, warehouse matching and
sync features come from the overhaul branch.

My Work keeps its original tables, responsive layout, filters and saved views,
assignment instructions, phone copy controls, details drawer, result/notes/DB/WH-ID
fields, autosave recovery, Done and reopen interactions. It does not introduce
manual-call forms, closure reasons, new WH-ID formatting rules or compulsory call
logging. Employee visibility and revision checks remain enforced.

## Boundaries

- `src/app/dashboard/my` contains the retained screen and loading layout.
- `my/classic` retains shared components whose redesigned versions change the
  employee experience. It still uses the common navigation and autosave context.
- `my/employee-work.css` preserves main's styles inside the employee content,
  status messages and portal dialogs. It leaves the new app shell and admin pages
  untouched. SVG presentation attributes must survive the style reset.
- `employee-work.ts`, `employee-work-filters.ts` and `employee-display.ts` preserve
  the personal read/filter/display contract while using the merged scoped readers.
- `/api/my-work/assignments/[id]` only edits the signed-in person's own tasks,
  including when an admin opens My Work. It accepts the original fields and a
  revision, and serializes reopening with allocation using the ownership lock.
- The existing `/api/assignments/[id]` route retains the newer manual-call rules.

## Database compatibility

Migration `018_employee_workflow_compat.sql` adds a narrow, transaction-local
exception to the quality trigger for updates through the own-task endpoint. The
actor must match the existing assignee; revision must advance once; only original
editable fields and completion metadata may change. It cannot insert, drop,
reassign, alter identity or rewrite manual-call evidence. Other updates retain the
quality guard. Warehouse, ownership and audit triggers still run.

The migration does not enable or disable triggers. Production's existing disabled
quality/contact-sync triggers remain unchanged; the app checks shared-contact
ownership when reopening. A fresh database with both triggers enabled also
supports the preserved employee workflow. Existing migrations remain immutable.

Run the ordinary integration suite on a fresh schema, and run
`tests/rehearse-shared-schema.mjs 707f7971fa6982b73e502d3ef8cc3ee778b54848` against
a disposable local cluster to rehearse production's retained schema and trigger
settings. The rehearsal verifies unchanged historical migration records, valid
009 indexes, the additive 018 upgrade and a second no-op migration run.

The deferred employee UI tests remain in the feature history and in
`tests/browser/deferred-employee`; they are not claims about the shipped screen.
The active browser checks cover the retained behavior and the new admin pages.

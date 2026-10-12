# Preserved Bolna fixes — unfinished work

The user requested rollback of the handoff fixes on 12 October 2026. This branch preserves the shipped commits `3eca75b` and `8fb7597`, plus the unfinished usability and operational-changelog work. It is not approved for redeployment.

## Local usability work

The call form has conditional fields and separate correction controls, with a combined call-and-completion action. Further changes address refresh races, error focus, onboarding confirmation and readable evidence labels. These latest changes have not completed verification.

The latest full browser run before those further changes had **225 passed, 3 failed and 2 skipped**. Failures concerned Team evidence labels, a stale row revision after recording a call, and validation focus. The subsequent fixes remain unverified. Earlier local checks passed 112 unit tests, 252 integration tests, typecheck and a production build; those results do not certify the final preserved working tree.

The operational Markdown changelog and its screenshots are drafts. The PDF has not been regenerated and does not match the latest Markdown. Do not send either as a completed release announcement.

## Production database

Migrations 006–008 were applied successfully on 12 October 2026 before the rollback request. Production readers were verified in an explicitly read-only transaction. See [the deployment record](docs/DEPLOYMENT.md).

The main-branch rollback retains migrated tables, call history, assignment history and migration ledger entries. The assignment quality and shared-phone ownership triggers must be disabled for the old application, which lacks the new completion and contact-allocation workflows. Re-enabling these rules and reviewing data written by the older app are required before redeploying this branch. Do not rerun the already applied migrations or edit their checksums.

The navigation blocker for unsaved drafts also exists in the pre-handoff app. Reverting the two handoff commits does not remove it.

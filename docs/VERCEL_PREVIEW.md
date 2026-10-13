# Vercel team preview

The review branch is `codex/bolna-visual-overhaul` in
`WareOnGo/ai-calling-wareongo`. Deploy it to the **Preview** environment of the
existing `wareongo/ai-calling-wareongo` Vercel project. `main` is the production
branch. The preview uses the existing live data with normal editing and calling.

Stable URL: https://ai-calling-wareongo-git-codex-bolna-visual-overhaul-wareongo.vercel.app

## Build settings

- Repository root: `.` (the repository itself is the Next.js app).
- Framework: Next.js; build: `npm run build`; default Next.js output.
- Node: `22.x`, pinned in `package.json` to match development and CI.
- Use the committed npm lockfile. A clean `npm ci`, typecheck, 112 unit tests and
  production build passed on 13 October 2026.
- The existing project enables Fluid compute. Its 300-second function limit
  supports this app's declared durations; no extra `vercel.json` is required.

## Environment and sign-in

The existing project already assigns the database, Google OAuth, session,
provider and worker variables to Preview and Production. Preserve those values.
The missing `BOLNA_ENGLISH_AGENT_ID` was added to Preview specifically for this
branch. All credentials stay server-side and outside Git.

Register the preview host's exact callback in the existing Google OAuth web
client's **Authorized redirect URIs**:

```text
https://ai-calling-wareongo-git-codex-bolna-visual-overhaul-wareongo.vercel.app/api/auth/google/callback
```

Use a stable branch URL or an alias when sharing the preview. The app derives its
callback from the current host; `GOOGLE_REDIRECT_URI` is not read. Adding an env
value with that name cannot replace registration in Google Cloud.

This branch URL has a Vercel deployment protection exception so teammates reach
the app's normal Google sign-in without needing Vercel accounts. The app's Google
sign-in and Team access checks still apply. Other deployment URLs retain the
project's existing protection settings.

`BOLNA_PREVIEW_DIST_DIR` belongs only to the local development launcher and must
not be added to Vercel. The local preview remains on port 3000.

## Database and provider configuration

Preview edits affect the shared live database. Keep the existing production
webhook and worker URLs; another dashboard URL does not require repointing them.
Builds do not run migrations or backfills.

A read-only check confirmed that baseline and migrations 001–008 are present
with matching checksums. The existing rollback's two disabled assignment triggers
were left as configured; no database migration or policy change was applied.

This branch retains the handoff backend used during the UI overhaul. `main` has
separate rollback and shared-phone fixes. Keep the preview separate; a later
production merge must reconcile that divergence and its database policy changes.
Do not re-enable shared database triggers as part of a preview deployment.

## Dependency audit

On 13 October 2026, patched `source-map-js` to 1.2.2 and `fast-uri` to 3.1.8.
`npm audit --omit=dev` reports **zero findings**. The complete audit still reports
10 development-tool findings (3 moderate, 5 high, 2 critical) in Prisma and
Vitest's dependency trees. Resolving those requires a separately tested tooling
upgrade; do not run `npm audit fix --force` as part of deployment. Neither the
Vitest server nor Prisma's development services run in the hosted application.

References: [Vercel environment scopes](https://vercel.com/docs/environment-variables),
[stable deployment URLs](https://vercel.com/docs/deployments/generated-urls),
[Node version overrides](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions),
[Google callback validation](https://developers.google.com/identity/protocols/oauth2/web-server#uri-validation).

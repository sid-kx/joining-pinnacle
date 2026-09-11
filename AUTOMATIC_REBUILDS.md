# Automatic CMS Rebuilds

## What Was Added

- `article.html` contains the fixed author, Jag Saini · Broker of Record, between
  title and date. `article.js` adds the matching Person author to Article JSON-LD.
  The static builder includes both in initial HTML. Testimonials have no author.
- `admin.js` calls `requestSiteRebuild()` after successful article/testimonial
  publish, edit (including media-only edits), and delete. It invokes `rebuild-site`
  through the existing signed-in Supabase client, never GitHub directly.
- `supabase/functions/rebuild-site/index.ts` is the Edge entrypoint, with the
  dependency-free, testable request handler in `handler.mjs`.
- `supabase/config.toml` keeps platform JWT verification enabled.
- The existing `.github/workflows/pages.yml` is reused without changes: install,
  tests, static build, upload `dist`, deploy Pages. No duplicate workflow exists.

## Required Configuration (Not Executed)

Create a fine-grained GitHub token with access to **only** `sid-kx/joining-pinnacle`
and repository **Actions: Read and write** permission. Set an expiration and
rotate it before expiry. The token only belongs in the Supabase project's
**Edge Functions > Secrets** configuration, never frontend code, a public table,
the repository, GitHub workflow source, or a chat message.

Secret names:

| Name | Configuration |
| --- | --- |
| `GITHUB_PAGES_TOKEN` | Required: the restricted GitHub credential described above. |
| `CMS_SUPABASE_PUBLISHABLE_KEY` | Recommended: this project's existing publishable key, configured server-side. Not a service-role key. |
| `SUPABASE_URL` | Automatically supplied by Supabase; do not replace it with caller input. |
| `SUPABASE_ANON_KEY` | Automatically supplied legacy public key; used only if the custom publishable-key setting is absent. |

Use Supabase Dashboard to set the two custom entries. Alternatively, an existing
private environment file **outside this repository** can be applied with:

```sh
supabase secrets set --project-ref daxrirnhbcfpqzswjofl --env-file "$HOME/.config/pinnacle/rebuild-site.env"
```

No secret file or secret values are included in this project. `.env*` and CLI
temporary folders are ignored as an additional safeguard.

From the project directory, deploy only this function:

```sh
cd /Users/sid/Desktop/Coding-Projects/joining-pinnacle-4-page
supabase functions deploy rebuild-site --project-ref daxrirnhbcfpqzswjofl
```

Authenticate the CLI using `supabase login` first if necessary. Do not disable
JWT verification. These commands have **not** been executed by this task.

Deploy the updated frontend/author markup via the existing Pages workflow as
well. `pages.yml` must exist on `main`, Actions must be enabled, and Settings >
Pages must use GitHub Actions. The existing slug migration is still a prerequisite
for static builds; this task does not execute or change it.

## Authorization and Failure Behavior

The Edge Function accepts POST, with OPTIONS for browser preflight. It:

1. Requires a bearer token and validates it against Supabase Auth's `/auth/v1/user`.
   A decoded JWT, caller-supplied user ID, or public API key is not authentication.
2. Rejects anonymous users and checks the returned user's ID in `education_admins`
   using the same JWT and existing RLS. Non-admins cannot dispatch.
3. Reads the GitHub secret only after authorization succeeds.
4. Dispatches the fixed `sid-kx/joining-pinnacle` / `pages.yml` / `main` target.
   Request data cannot override the repository, workflow, branch or credentials.
5. Returns only accepted/error JSON, with no upstream bodies or secret details.
   Requests time out and redirects are rejected so credentials are not forwarded.

CORS allows only `https://join.pinnaclerealty.ca`. Local preview dispatch requests
are intentionally rejected; automated tests mock the function. Non-browser calls
still require valid authenticated admin credentials.

Accepted dispatch means GitHub queued a build, **not** that deployment finished.
The existing workflow serializes deployments. A failed/expired token, unavailable
function, network error, or GitHub rejection adds a rebuild warning to the normal
save/delete success message. It does not roll back database or Storage changes.
Any separate post-save Storage cleanup warning is preserved. Check GitHub Actions
for later build failures, and manually run **Build Pinnacle Pages** to recover.

This integration covers writes made through this CMS. Direct SQL, Supabase
Dashboard edits, another client, or closing the browser before dispatch can miss
the request. A durable database-triggered queue/webhook is a separate future
enhancement; this implementation does not claim that guarantee.

## URL and Static SEO Behavior

Permanent routes/canonicals are unchanged:

- `https://join.pinnaclerealty.ca/articles/<slug>/`
- `https://join.pinnaclerealty.ca/testimonials/<slug>/`

Query-string fallbacks remain while a route is absent from the deployed
`post-routes.json`. On a fresh page load, cards automatically use clean routes
listed in that manifest. Already-open lists need a refresh to read a newer
manifest. No speculative clean links or custom-404 routing are introduced.

The static build continues including title, body, publication date, canonical,
description, Open Graph metadata/image, and JSON-LD in initial HTML; articles now
also contain the author. Dedicated thumbnails remain metadata/card images, not
extra body-gallery images. Generated pages remain SEO mode A after deployment.

## Tests

`npm test` includes CMS success/failure checks for all six dispatch points,
image-only edits, saved-with-cleanup-warning, no rollback after dispatch failure,
author presence/order in static HTML and JSON-LD, testimonial author exclusion,
and mocked Edge authentication/admin/CORS/secret-isolation/dispatch failures.
No deployment, real GitHub dispatch, production CMS write, or SQL is executed.

Verification for this change: 64 test groups pass (44 CMS, 14 content/static,
6 Edge/security). The production-data build also succeeds and generates five
static pages. Author placement was checked at mobile width. The Edge handler and
entrypoint are tested with mocked Auth/GitHub responses in Node; a deployed
Supabase/GitHub end-to-end test still requires configuring secrets and deployment.

References:
- [Supabase Auth integration](https://supabase.com/docs/guides/functions/auth-legacy-jwt)
- [Supabase Edge Function secrets](https://supabase.com/docs/guides/functions/secrets)
- [GitHub workflow dispatch and token permissions](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)

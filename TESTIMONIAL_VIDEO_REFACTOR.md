# Video-only Testimonials

## Status

Frontend/CMS refactor only. No SQL has been written or executed, no policies or
buckets changed, no live content mutated, and nothing pushed or deployed.
Complete the compatibility migration below before deploying URL-only publishing.
The current database may still require legacy fields or run the old slug trigger.

## Implementation

- `admin.html`: testimonial publishing and a separate admin editor each contain
  one required YouTube URL field. Article forms/editors are retained.
- `admin.js`: testimonial insert/update write only `youtube_url` and `youtube_id`.
  Reads use `id,youtube_url,youtube_id,created_at`. Deletes remove only the row,
  require a returned ID, keep confirmation, and refresh the list. Legacy fields
  are never cleared or rewritten. Failures retain drafts and show errors.
- `youtube.js`: the existing strict CMS URL parser moved unchanged into a shared
  helper. Supports watch, Shorts, youtu.be and embed links, strict hosts and
  11-character IDs, with supported query strings and trailing slash.
- `testimonials.js`: public gallery fetches newest-first, skips invalid rows and
  falls back to parsing a legacy URL when its stored ID is missing/invalid.
  Empty/error states show "Testimonials coming soon."
- `index.html` / `style.css`: three desktop portrait cards, up to 360 x 640px.
  View More reveals the next three and disappears when exhausted. At the existing
  900px breakpoint, a fixed three-slot looping carousel replaces the desktop grid.
  Center width is min(82% of the container, 340px), always 9:16. Side peeks scale
  to 88%. One item has no peeks/navigation; two reuse the single neighbor on each
  side. Horizontal gestures require 50px and must dominate vertical movement.
- Only an explicit play click creates a standard YouTube embed. Posters are lazy
  images, not eager players. Starting another video, moving slides, or crossing
  the layout breakpoint removes the active iframe to stop its audio. Native
  YouTube controls remain unobstructed; while playing, use the surrounding track,
  side peeks, or navigation buttons rather than intercepting iframe gestures.
- Keyboard arrows, labeled native buttons and reduced-motion support are included.
- `testimonial.html` is deleted. `article.js`/`content.js` remove only testimonial
  routing/mode branches. Shared media CSS used by Articles is retained.
- `scripts/build-pages.cjs`: Articles only; no testimonial reads, output pages,
  manifest entries, or sitemap entries. New gallery/parser assets are copied.
- Testimonial changes no longer invoke `rebuild-site`: the homepage reads current
  records on load. Article rebuild calls, Edge Function and workflow are unchanged.
  Existing visitors are not live-subscribed; refresh to see subsequent changes.
- Old testimonial URLs will no longer have generated pages after the next approved
  deployment. No redirect system or invented host routing was added.

## SUPABASE MIGRATION REQUIRED

### Evidence and limits

The frontend previously selected `id,title,article,youtube_url,youtube_id,
image_urls,thumbnail_url,created_at`, plus optional slug support. It required
title/body in JavaScript; that does NOT prove database NOT NULL constraints.
The repository has no base table DDL describing the live nullability/checks.
A read-only public OpenAPI schema request returned 401. Therefore live constraint
names, ID type/default and policy definitions still need confirmation in Supabase.
No live schema assumptions were bypassed with placeholder titles/body/slugs.

The checked-in historical `migrations/001_content_slugs.sql` defines:

- Nullable `agent_testimonials.slug text`.
- Partial unique index `agent_testimonials_slug_unique` on non-null slugs.
- Trigger `pinnacle_content_slug` on `public.agent_testimonials`, before insert
  or update, calling shared `public.pinnacle_assign_slug()` and using title/slug.

Confirm these exist in the deployed database before changing them. That same
trigger name also exists on `education_videos`; leave the Article instance,
Article index, and shared slug functions intact. Historical SQL was not edited.

### Required compatibility changes before deployment

1. Make `title`, `article`, `image_urls`, `thumbnail_url`, and `slug` optional for
   testimonial inserts/updates. Remove testimonial-only NOT NULL or non-empty
   checks that demand these values, where present. Inspect defaults and dependent
   checks/triggers; URL-only inserts must succeed with just the two video fields.
   A retained `image_urls` empty-array default is harmless. Existing data remains.
2. Remove/disable only the testimonial `pinnacle_content_slug` trigger. Otherwise
   it will keep generating unused slugs (and may fail if its referenced columns
   are eventually removed). Inspect any other testimonial-only rebuild or legacy
   content triggers installed outside this repo; retire them only if unnecessary.
   No external database triggers were inspected or changed by this code task.
3. Retire `agent_testimonials_slug_unique` and any actual testimonial slug UNIQUE
   constraint/index discovered during inspection. This index does not block NULL
   inserts itself, but no longer serves the model. Keep the primary key and useful
   `created_at` indexes. No new slug or title indexes are required.
4. Preserve existing `id` generation and `created_at` timestamp default. Neither
   value is supplied by the new publish form. Do not convert the primary key type.
5. Validate new video values: `youtube_url` must be a supported non-empty YouTube
   URL, and `youtube_id` exactly 11 characters matching `[A-Za-z0-9_-]`. They must
   identify the same video. Frontend validation is present; any database checks
   should preserve the same supported Shorts/share/watch/embed URL forms.

### Recommended non-destructive rollout / final model

Do NOT drop historical content during the first migration. Retain the five
obsolete fields as nullable legacy data. That compatibility schema works with
the new code and avoids losing bodies, image references, thumbnails and slugs.

After backup/export and explicit approval for a separate cleanup, the final
minimal `public.agent_testimonials` table should contain exactly:

| Column | Final expectation |
| --- | --- |
| `id` | Existing primary key, existing type and generated default unchanged |
| `youtube_url` | `text`, required, validated original supported YouTube URL |
| `youtube_id` | `text`, required, valid 11-character ID matching the URL |
| `created_at` | Existing timestamp type/default retained; preserve existing dates |

`title`, `article`, `slug`, `image_urls`, and `thumbnail_url` are all unnecessary
to the new application and may then be dropped. Dropping them is optional cleanup,
not required for activation. Do not use cascading drops against unknown dependencies.
Removing `slug` is preferred in the eventual minimal model, not during preservation.

### Existing rows and backfill

- Valid IDs remain usable immediately, even if older URL fields are absent.
- A valid supported URL with a missing/invalid ID is parsed on the homepage; a
  separate reviewed backfill can persist that ID without changing other content.
- A valid ID with a missing URL can be assigned its standard watch URL in a later
  reviewed backfill. New writes preserve the original submitted URL.
- Video-less or malformed historical rows are skipped publicly and remain visible
  for editing/deletion in admin. Do not delete them automatically or invent IDs.
- Audit mismatched ID/URL pairs manually. The public renderer prefers a valid
  stored ID, as requested; saving in admin makes both fields agree.
- Do not apply table-wide required-video constraints until invalid legacy rows
  have been corrected or separately archived with approval. Stage validation for
  new/changed rows while preserving old rows, then validate the whole table and
  apply final NOT NULL constraints when every retained row qualifies.

### RLS / Storage

- Keep RLS enabled: public SELECT and education_admins-authorized authenticated
  INSERT/UPDATE/DELETE (and returned-row SELECT) should remain. No new policy is
  inherently required. Inspect live policy conditions for references to retired
  fields; adapt only those references if present without broadening access.
- `testimonial-images` is no longer read, uploaded to, or cleaned by testimonial
  code. Existing objects are intentionally untouched. Deleting a legacy row now
  deletes ONLY its record, not those old files.
- Do not delete the bucket or its contents as part of this refactor. Export and
  audit historical references first; bucket/policy removal is optional separately
  approved cleanup after confirming no other consumer uses it.
- `video-images`, `education_videos`, article policies/storage/authentication and
  article rebuild infrastructure need NO migration for this task.

## Verification

Automated suites cover URL-only CMS writes, failure/double-submit handling,
no testimonial Storage/rebuild calls, strict Shorts parsing, desktop batches,
mobile wrapping for 1/2/3/7 records, bounded slots, swipe thresholds/cancellation,
keyboard navigation, playback replacement, and article-only static output.
Existing Article persistence, rich text, SEO/media and rebuild security suites
remain enabled. Browser checks use isolated local fixture records, not live writes.

Results: `npm test` passed all 62 groups (28 CMS, 19 content/static, 9 gallery,
6 rebuild/security), including JavaScript syntax checks. `npm run build` succeeded
with five Article pages; the output manifest and sitemap contain no testimonial
routes, and neither a testimonial directory nor template is copied into `dist`.

Browser dimensions checked: 375, 390, 430, 768, 1024, 1280 and 1440px. No horizontal
overflow; all player frames retained 9:16. Desktop batches progressed 3 -> 6 -> 7.
Mobile gestures wrapped forward/backward, and one/two-item cases were checked.
Verified no iframe on initial load, iframe replacement on play, fullscreen/inline
attributes, and removal on slide change. The embedded preview left YouTube's
iframe blank, so actual remote playback/audio/fullscreen could not be confirmed
there. A normal-browser playback check remains before deployment. CMS persistence
was mocked, not tested by writing production records before the migration.

## File Inventory

Modified: `admin.html`, `admin.js`, `index.html`, `style.css`, `article.js`,
`content.js`, `scripts/build-pages.cjs`, `package.json`, `tests/cms.test.cjs`,
`tests/content.test.cjs`, and the three historical notes `CMS_BACKEND_NOTES.md`,
`CONTENT_MIGRATION.md`, `AUTOMATIC_REBUILDS.md` (superseded-testimonial notices only).

Created: `youtube.js`, `testimonials.js`, `tests/testimonials.test.cjs`, and this note.
Deleted: `testimonial.html`.

CMS functions changed: `handleTestimonialSubmit`, `loadTestimonials`,
`deleteTestimonial`; `extractYoutubeId` now delegates to the moved parser.
Added `openTestimonialEditor`, `closeTestimonialEditor`, `saveTestimonialEdit`.
Removed `uploadTestimonialImages`, `getTestimonialImagePath`,
`removeTestimonialImages`, `getTestimonialCover`, `persistTestimonialEdit` and the
old homepage inline detail-card renderer. `openContentEditor` / `saveContentEdits`
only lose testimonial branches; Article save/storage helpers remain unchanged.

Public helpers added: `YouTube.extractId`, `validId`, `idFromPost`, and
`TestimonialGallery.Gallery`, `wrap`, `swipeStep`. Article route helpers and
`renderPage` / `build` only lose testimonial support.

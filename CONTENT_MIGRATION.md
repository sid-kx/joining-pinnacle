# Slugs and Rich Text

## Activation

The deployment was verified as GitHub Pages at `join.pinnaclerealty.ca`. Both
tables were checked read-only during implementation: neither had a `slug` column.
No SQL, policies, Storage buckets, authentication settings, or live deployment
were changed by this task.

1. Run the exact contents of `migrations/001_content_slugs.sql` in Supabase SQL Editor.
   It adds nullable text columns, unique partial indexes, deterministic backfill,
   and an invoker trigger that assigns missing slugs and preserves existing ones.
   Existing nonempty slugs stay unchanged. Duplicate existing slugs abort the
   transaction instead of overwriting content. No RLS policies are altered.
2. Reload the admin panel after migration, since schema capability is cached per
   page load. New saves include slugs automatically. Duplicate titles get `-2`,
   `-3`, and so on. Editing a title keeps its existing slug.
3. In the repository's Settings > Pages, choose GitHub Actions as the publishing
   source. Commit/push these files to `main`, or run the Pages workflow manually.
   The workflow installs dependencies, runs tests, builds, then deploys `dist`.
   This task did not commit, push, or run the workflow.
4. Re-run the workflow after publishing, editing, or deleting CMS content. GitHub
   Pages cannot rebuild itself from a browser Supabase write. No GitHub tokens or
   service-role credentials belong in the client. Automated Supabase-to-build
   dispatch can be added separately using a trusted server-side integration.

## URLs and SEO

Generated URLs are `/articles/<slug>/` and `/testimonials/<slug>/`. The trailing
slash matches GitHub Pages directory-index hosting. No hash routes, fake host
rewrites, or custom-404 routing are used.

`npm run build` reads public rows and creates a real `index.html` in each route
directory. Title, sanitized body, media, canonical, Open Graph metadata, and
article structured data are present in the initial HTML. It also writes a sitemap
and route manifest. This is **mode A: static unique HTML**, once built and deployed.
The browser hydrates the media controls and refreshes from Supabase; a snapshot
keeps generated content readable when refresh fails. Deletion requires a rebuild
to remove the old HTML from hosting/search engines.

Before the SQL migration, existing `article.html?id=...` links remain functional
and testimonials use equivalent ID links. After migration, a post not yet in the
deployed route manifest uses `article.html?slug=...` or `testimonial.html?slug=...`.
Those temporary templates are **mode B: client-rendered**, not server-rendered
SEO. Once built, cards link to the clean route, and legacy query URLs redirect to
it in the browser. The query fallback avoids dead links between publishing and
the next build. It is not a replacement for generating/deploying the HTML.

## Rich Text

Quill 2.0.2 is self-hosted with DOMPurify 3.4.15. Both Add forms and the shared
Edit form use the same editor. The toolbar supports paragraphs, H2/H3, bold,
italic, underline, lists, links, blockquotes, alignment, size, and limited fonts.
Formatted clipboard HTML is sanitized before import; plain-text-only clipboard
data cannot carry formatting that was not supplied by the source application.

DOMPurify sanitizes again on save and public rendering. Tags are limited to
paragraphs, line breaks, emphasis, H2/H3/H4, lists, links, quotes, and spans.
Only safe HTTP/HTTPS/mailto/tel links, bounded 12-32px text sizes, limited font
families, alignment, bold/italic/underline, and known Quill indentation classes
survive. Scripts, embedded media, events, executable URLs, and other styles do not.
YouTube stays in the existing separate field.

New rich bodies use `<!--pinnacle-rich-text:v1-->` in the existing `article` column.
Unmarked legacy text remains escaped text with paragraph/line-break preservation.
Unchanged legacy content is not silently rewritten when editing other fields.
Rich content loads with formatting in the editor, and excerpts/metadata use plain
text. Dedicated thumbnails are never injected into the body gallery.

## Local Checks

```sh
npm ci --ignore-scripts
npm run vendor
npm test
npm run build
npm run dev -- dist
```

The production build intentionally fails if migration is missing, instead of
deploying empty pages. Tests use mocked database/Storage calls and fixture posts;
they never publish to or delete from live Supabase. `npm run dev` without `dist`
previews source templates on port 5514; `PORT=5515` selects a different port.
Dependency assets/licenses are in `vendor`; refresh them with `npm run vendor`
after intentionally updating the pinned package versions.

## Change Inventory

Modified existing files:

- `admin.html`: editor assets and Add/Edit body fields (approximately 10-12,
  279, 342, 419, 456-460).
- `admin.js`: `loadVideos`, `loadTestimonials`, `getVideoContentDraft`, both
  submit handlers, `openContentEditor`, both `persist...Edit` functions,
  `saveContentEdits`, and `trimWords` (approximately 58-251, 368-423, 486-581,
  764-784, 884-1025, 1052-1086). These call shared rich-text/slug helpers; the
  existing upload, deletion, rollback, thumbnail and authentication mechanics
  remain in place.
- `blog.html`: `loadEducationVideos` and `renderEducationVideos` (922-1036).
- `index.html`: `loadTestimonials`, `renderTestimonials`, and `trimWords`
  (610-708); cards are links. Removed `openTestimonial`, `closeTestimonial`,
  old modal markup, and modal-only click/Escape/backdrop listeners. Media now
  opens on the dedicated testimonial page instead.
- `article.html`: root-safe base URL, content-kind marker, shared assets.
- `article.js`: `renderArticle`, `renderArticleCarousel`,
  `updateArticleMetadata`, and `loadArticle` (14-166). The shared renderer now
  serves articles and testimonials, including slug lookup and legacy redirect.
- `.gitignore` and `tests/cms.test.cjs`: generated-file exclusions and regression
  coverage. `supabase.js`, `script.js`, `style.css`, `login.html` and `CNAME`
  were not modified.

Created files:

- `content.js`: `slugify`, `validSlug`, `supportsSlugs`, `select`, `uniqueSlug`,
  `write`, `path`, `loadRoutes`, `url` (approximately 7-70).
- `rich-text.js`: `sanitize`, `toHTML`, `text`, `serialize`, `set`, `read`,
  `mount`, and `SafeClipboard.convert` (10-141).
- `rich-text.css`: scoped editorial typography and dark editor styling.
- `testimonial.html`: dedicated page using the existing public navigation and
  shared article renderer; no extra testimonial JavaScript duplicate.
- `scripts/build-pages.cjs`: `renderPage`, `readPosts`, `build` (8-71).
- `scripts/vendor.cjs`, `scripts/preview.cjs`, `.github/workflows/pages.yml`,
  `package.json`, `package-lock.json`, and the pinned assets/licenses in `vendor`.
- `migrations/001_content_slugs.sql`, `tests/content.test.cjs`, and this document.

## Verification Results

- 36 CMS groups and 14 slug/rich-text/static-page groups pass, including both
  content types with rich bodies, slugs, thumbnails, gallery changes and rollback.
- 14 JavaScript files/inline blocks pass syntax checks. Dependency audit reports
  zero known vulnerabilities. SQL has been reviewed but **not executed**.
- Mock-only browser checks cover formatted paste, publish, edit/save, dedicated
  article/testimonial navigation, carousel looping, and mobile navigation.
- Public page layout checked at 375, 430, 768, 1024 and 1440px; no horizontal
  overflow observed. The editor was also checked at 375px.
- Fixture builds prove full body/metadata exist in initial HTML for both types.
  The live build correctly stops with `42703: education_videos.slug does not
  exist` until the migration is run. No production CMS writes were made.

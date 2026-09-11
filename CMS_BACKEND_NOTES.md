# CMS Thumbnail and Edit Integration

## Current Status

Both article and testimonial thumbnail publishing and editing are wired to the existing authenticated Supabase browser client. The user has confirmed the testimonial schema and policy migration is complete. This task uses mocked backend tests, not production writes or live policy introspection.

- Articles use `education_videos.thumbnail_url` and the existing `video-images` bucket under `videos/`. Article persistence was left unchanged during the testimonial wiring.
- Testimonials use `agent_testimonials.thumbnail_url` and the existing `testimonial-images` bucket under `testimonials/`.
- Both thumbnail fields are nullable text. A dedicated thumbnail is stored separately from `image_urls` and is not automatically inserted into either carousel.
- Public/admin covers prefer the dedicated thumbnail, then the first gallery image, then the Pinnacle placeholder. No YouTube thumbnail is generated.
- The testimonial admin/public queries now include `thumbnail_url`. The editor receives that field from the published list.
- No additional SQL, policies, bucket creation, or authentication changes were made.

## Testimonial Write Safety

`handleTestimonialSubmit()` validates the required title/article, optional supported YouTube URL, at most 10 gallery images and one thumbnail. It uploads the gallery and thumbnail separately, inserts the row, and requires a returned ID. Duplicate submissions are blocked while publishing.

`uploadTestimonialImages()` uploads sequentially with unique filenames, one-year cache control and no overwrite. On a partial failure it removes files successfully uploaded by that call. Publishing and editing also roll back earlier completed batches if a later upload or database operation fails. Rollback failure is reported explicitly for manual cleanup.

`persistTestimonialEdit()` uploads new files, updates the existing row, and requires a returned ID before removing obsolete old files. Retained gallery and thumbnail references are compared by validated Storage path and deduplicated. A file still used in either location is not deleted. Failed updates leave the editor open with its values; post-save cleanup failures preserve the successful update and show a warning.

`deleteTestimonial()` fetches both gallery and thumbnail URLs, cleans only validated objects from this project's `testimonial-images/testimonials/` prefix, then deletes the row. It retains the existing confirmation and reports Storage versus database failures separately. This remains a multi-request operation, not an atomic database/Storage transaction.

`getTestimonialImagePath()` rejects foreign origins/buckets, credentials, malformed encoding, traversal, control characters and paths outside the existing testimonial upload prefix. Cleanup never targets `video-images`.

## Backend Assumptions

The existing policies must continue authorizing the intended `education_admins` users to SELECT/INSERT/UPDATE/DELETE the corresponding rows and upload/delete objects in the existing buckets. Public readers need SELECT and public image access. This upload-new/delete-old approach does not overwrite Storage objects in place.

## Verification

Run `node tests/cms.test.cjs` for dependency-free mocked CMS tests and JavaScript syntax checks. Tests never contact Supabase. An authorized staging smoke test remains appropriate for verifying actual policy behavior and uploads.

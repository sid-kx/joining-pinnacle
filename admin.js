const form = document.getElementById("video-form");
const urlInput = document.getElementById("youtube-url");
const videoTitle = document.getElementById("video-title");
const videoArticle = document.getElementById("video-article");
const videoImages = document.getElementById("video-images");
const videoThumbnail = document.getElementById("video-thumbnail");
const messageBox = document.getElementById("admin-message");
const list = document.getElementById("admin-video-list");
const logoutButton = document.getElementById("logout");
const testimonialForm = document.getElementById("testimonial-form");
const testimonialTitle = document.getElementById("testimonial-title");
const testimonialArticle = document.getElementById("testimonial-article");
const testimonialYoutubeUrl = document.getElementById("testimonial-youtube-url");
const testimonialImages = document.getElementById("testimonial-images");
const testimonialThumbnail = document.getElementById("testimonial-thumbnail");
const testimonialMessage = document.getElementById("testimonial-message");
const testimonialList = document.getElementById("admin-testimonial-list");

const TESTIMONIAL_IMAGE_BUCKET = "testimonial-images";
const VIDEO_IMAGE_BUCKET = "video-images";
const publishedVideos = new Map();
const publishedTestimonials = new Map();

async function initializeAdmin() {
  const {
    data: { session },
    error: sessionError
  } = await db.auth.getSession();

  if (sessionError || !session) {
    window.location.href = "login.html";
    return;
  }

  const {
    data: admin,
    error: adminError
  } = await db
    .from("education_admins")
    .select("user_id")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (adminError || !admin) {
    console.error("Admin verification failed:", adminError);

    await db.auth.signOut();
    window.location.href = "login.html";
    return;
  }

  await Promise.all([
    loadVideos(),
    loadTestimonials()
  ]);
}

async function loadVideos() {
  publishedVideos.clear();
  list.innerHTML = `
    <div class="empty-state">
      Loading articles...
    </div>
  `;

  const {
    data: videos,
    error
  } = await Content.select(db, "education_videos", "id,youtube_id,youtube_url,title,article,image_urls,thumbnail_url,created_at", query => query.order("created_at", { ascending: false }));

  if (error) {
    console.error("Video load error:", error);

    list.innerHTML = `
      <div class="empty-state">
        Unable to load articles: ${escapeHtml(error.message)}
      </div>
    `;

    return;
  }

  if (!videos || videos.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        No articles have been published yet.
      </div>
    `;

    return;
  }

  list.innerHTML = videos.map(video => {
    publishedVideos.set(String(video.id), video);
    const cover = getVideoCover(video);

    return `
    <article class="admin-video">

      ${cover ? `
        <img
          src="${escapeHtml(cover)}"
          alt="${escapeHtml(video.title)}"
          loading="lazy"
          decoding="async"
        >
      ` : `<div class="admin-video-placeholder" aria-hidden="true">P</div>`}

      <div>

        <h3>
          ${escapeHtml(video.title)}
        </h3>

        <p>${escapeHtml(trimWords(video.article, 22))}</p>

        ${video.youtube_url ? `<a
          href="${escapeHtml(video.youtube_url)}"
          target="_blank"
          rel="noopener"
        >
          View on YouTube ↗
        </a>` : ""}

      </div>

      <div class="admin-actions">
      <button class="edit-post" data-kind="article" data-id="${escapeHtml(video.id)}" type="button">Edit</button>
      <button
        class="delete-video"
        data-id="${video.id}"
        type="button"
      >
        Delete
      </button>
      </div>

    </article>
  `;
  }).join("");

  attachEditButtons(list);

  document
    .querySelectorAll(".delete-video")
    .forEach(button => {
      button.addEventListener("click", () => {
        deleteVideo(button.dataset.id);
      });
    });
}

function getVideoCover(video) {
  if (typeof video.thumbnail_url === "string" && video.thumbnail_url.trim()) {
    return video.thumbnail_url.trim();
  }
  const firstImage = Array.isArray(video.image_urls) ? video.image_urls[0] : null;
  if (typeof firstImage === "string" && firstImage.trim()) {
    return firstImage;
  }
  return "";
}

function getVideoContentDraft() {
  const youtubeUrl = urlInput.value.trim();

  return {
    title: videoTitle.value.trim(),
    article: RichText.read(videoArticle),
    youtube_url: youtubeUrl || null,
    youtube_id: extractYoutubeId(youtubeUrl) || null,
    images: Array.from(videoImages.files || []),
    thumbnails: Array.from(videoThumbnail.files || [])
  };
}

let videoPublishing = false;

form.addEventListener("submit", handleVideoSubmit);

async function handleVideoSubmit(event) {
  event.preventDefault();

  if (videoPublishing) {
    return;
  }

  const draft = getVideoContentDraft();

  const fileError = validateContentImages(draft.images, draft.thumbnails);
  if (fileError) {
    messageBox.textContent = fileError;
    return;
  }

  if (!draft.title) {
    messageBox.textContent = "Add a title first.";
    return;
  }

  if (draft.images.length > 10) {
    messageBox.textContent =
      "Select 10 video images or fewer.";
    return;
  }

  if (draft.youtube_url && !isSupportedVideoYoutubeUrl(draft.youtube_url, draft.youtube_id)) {
    messageBox.textContent =
      "Enter a valid YouTube watch, youtu.be or embed link, or leave the YouTube field blank.";
    return;
  }

  const submitButton = form.querySelector('button[type="submit"]');
  videoPublishing = true;
  submitButton.disabled = true;
  messageBox.textContent = "Publishing article...";

  let imageUrls = [];
  let thumbnailUrls = [];
  let publishedId;

  try {
    imageUrls = await uploadVideoImages(draft.images);
    thumbnailUrls = await uploadVideoImages(draft.thumbnails);

    const { data, error } = await Content.write(db, "education_videos", {
        title: draft.title,
        article: draft.article || null,
        youtube_url: draft.youtube_url,
        youtube_id: draft.youtube_id,
        image_urls: imageUrls,
        thumbnail_url: thumbnailUrls[0] || null
      });

    if (error) {
      throw new Error(`Database insert failed: ${error.message}`);
    }
    if (!data?.id) {
      throw new Error("Database insert did not return an article ID.");
    }
    publishedId = data.id;
  } catch (error) {
    let message = error?.message || "Unable to publish the article.";
    if (imageUrls.length || thumbnailUrls.length) {
      try {
        await removeVideoImages([...imageUrls, ...thumbnailUrls]);
      } catch (cleanupError) {
        message += ` Image rollback also failed: ${cleanupError.message}. Uploaded images may need manual cleanup.`;
      }
    }
    console.error("Video publishing failed:", error);
    messageBox.textContent = `Article was not published. ${message}`;
    return;
  } finally {
    videoPublishing = false;
    submitButton.disabled = false;
  }

  messageBox.textContent = `Article published successfully. Database ID: ${publishedId}`;
  form.reset();
  try {
    await loadVideos();
  } catch (error) {
    messageBox.textContent += " Unable to refresh the list. Reload to see the published article.";
    console.error("Video list refresh failed:", error);
  }
}

function isSupportedVideoYoutubeUrl(value, youtubeId) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(youtubeId || "")) {
    return false;
  }
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
      return false;
    }
    if (["youtu.be", "www.youtu.be"].includes(url.hostname)) {
      return url.pathname === `/${youtubeId}`;
    }
    if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)) {
      return (url.pathname === "/watch" && url.searchParams.get("v") === youtubeId) ||
        url.pathname === `/embed/${youtubeId}`;
    }
    return ["youtube-nocookie.com", "www.youtube-nocookie.com"].includes(url.hostname) &&
      url.pathname === `/embed/${youtubeId}`;
  } catch {
    return false;
  }
}

function getVideoImagePath(value) {
  if (typeof value !== "string") {
    return null;
  }
  try {
    const url = new URL(value);
    const prefix = `/storage/v1/object/public/${VIDEO_IMAGE_BUCKET}/`;
    if (url.origin !== new URL(SUPABASE_URL).origin || url.username || url.password || !url.pathname.startsWith(prefix)) {
      return null;
    }
    const path = decodeURIComponent(url.pathname.slice(prefix.length));
    if (!path.startsWith("videos/") || /[\\\x00-\x1f\x7f]/.test(path) ||
        path.split("/").some(part => !part || part === "." || part === "..")) {
      return null;
    }
    return path;
  } catch {
    return null;
  }
}

async function removeVideoImages(imageUrls) {
  const paths = [...new Set(imageUrls.map(getVideoImagePath).filter(Boolean))];
  if (!paths.length) {
    return;
  }
  const { error } = await db.storage.from(VIDEO_IMAGE_BUCKET).remove(paths);
  if (error) {
    throw new Error(`Storage cleanup failed: ${error.message}`);
  }
}

async function uploadVideoImages(files) {
  if (files.length > 10) {
    throw new Error("Select 10 video images or fewer.");
  }
  const imageUrls = [];
  try {
    // Sequential uploads preserve cover order and make partial rollback deterministic.
    for (const [index, file] of files.entries()) {
      const suffix = file.name.includes(".") ? file.name.split(".").pop().toLowerCase() : "jpg";
      const extension = /^[a-z0-9]{1,10}$/.test(suffix) ? suffix : "jpg";
      const id = crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`;
      const path = `videos/${id}.${extension}`;
      const bucket = db.storage.from(VIDEO_IMAGE_BUCKET);
      const { data } = bucket.getPublicUrl(path);
      if (!data?.publicUrl || getVideoImagePath(data.publicUrl) !== path) {
        throw new Error("Unable to generate a valid video image URL.");
      }
      const { error } = await bucket.upload(path, file, {
        cacheControl: "31536000",
        upsert: false
      });
      if (error) {
        throw new Error(`Unable to upload ${file.name}: ${error.message}`);
      }
      imageUrls.push(data.publicUrl);
    }
    return imageUrls;
  } catch (error) {
    try {
      await removeVideoImages(imageUrls);
    } catch (cleanupError) {
      throw new Error(`${error.message} Image rollback also failed: ${cleanupError.message}. Uploaded images may need manual cleanup.`);
    }
    throw error;
  }
}

let testimonialPublishing = false;
if (testimonialForm) {
  testimonialForm.addEventListener("submit", handleTestimonialSubmit);
}

async function handleTestimonialSubmit(event) {
  event.preventDefault();
  if (testimonialPublishing) return;

  const title = testimonialTitle.value.trim();
  const article = RichText.read(testimonialArticle);
  const youtubeUrl = testimonialYoutubeUrl.value.trim();
  const youtubeId = extractYoutubeId(youtubeUrl);
  const files = Array.from(testimonialImages.files || []);
  const thumbnails = Array.from(testimonialThumbnail.files || []);
  const fileError = validateContentImages(files, thumbnails);
  if (!title || !RichText.text(article) || fileError) {
    testimonialMessage.textContent = fileError || "Add a title and article first.";
    return;
  }
  if (youtubeUrl && !isSupportedVideoYoutubeUrl(youtubeUrl, youtubeId)) {
    testimonialMessage.textContent = "Enter a supported YouTube link, or leave it blank.";
    return;
  }

  const submitButton = testimonialForm.querySelector('button[type="submit"]');
  testimonialPublishing = true;
  submitButton.disabled = true;
  testimonialMessage.textContent = "Publishing testimonial...";
  const uploaded = [];
  let publishedId;
  try {
    const imageUrls = await uploadTestimonialImages(files);
    uploaded.push(...imageUrls);
    const thumbnailUrls = await uploadTestimonialImages(thumbnails);
    uploaded.push(...thumbnailUrls);
    const { data, error } = await Content.write(db, "agent_testimonials", {
        title, article,
        youtube_url: youtubeUrl || null,
        youtube_id: youtubeId || null,
        image_urls: imageUrls,
        thumbnail_url: thumbnailUrls[0] || null
      });
    if (error || !data?.id) {
      throw new Error(`Database insert failed: ${error?.message || "No testimonial ID was returned."}`);
    }
    publishedId = data.id;
  } catch (error) {
    let message = error?.message || "Unable to publish the testimonial.";
    try {
      await removeTestimonialImages(uploaded);
    } catch (cleanupError) {
      message += ` New-image rollback also failed: ${cleanupError.message}. Manual Storage cleanup may be needed.`;
    }
    testimonialMessage.textContent = `Testimonial was not published. ${message}`;
    console.error("Testimonial publishing failed:", error);
    return;
  } finally {
    testimonialPublishing = false;
    submitButton.disabled = false;
  }
  testimonialMessage.textContent = `Testimonial published successfully. Database ID: ${publishedId}`;
  testimonialForm.reset();
  try {
    await loadTestimonials();
  } catch (error) {
    testimonialMessage.textContent += " Reload the page to refresh the published list.";
    console.error("Testimonial list refresh failed:", error);
  }
}

async function deleteVideo(id) {
  const confirmed = window.confirm("Are you sure you want to delete this article?");
  if (!confirmed) {
    return;
  }

  let failureMessage = "Unable to load the video for deletion. Nothing was deleted.";

  try {
    const { data: video, error: fetchError } = await db
      .from("education_videos")
      .select("image_urls,thumbnail_url")
      .eq("id", id)
      .single();

    if (fetchError) {
      throw fetchError;
    }

    const imageUrls = Array.isArray(video.image_urls)
      ? video.image_urls.filter(url => getVideoImagePath(url))
      : [];
    if (getVideoImagePath(video.thumbnail_url)) imageUrls.push(video.thumbnail_url);

    if (imageUrls.length) {
      failureMessage = "Video image Storage cleanup failed. The video row was kept. Check Storage delete permissions and try again.";
      await removeVideoImages(imageUrls);
    }

    failureMessage = imageUrls.length
      ? "Video images were removed, but database deletion failed. Check database delete permissions and retry."
      : "Video database deletion failed. Check database delete permissions and retry.";

    const { error: deleteError } = await db
      .from("education_videos")
      .delete()
      .eq("id", id)
      .select("id")
      .single();

    if (deleteError) {
      throw deleteError;
    }
  } catch (error) {
    console.error("Video deletion failed:", error);
    alert(`${failureMessage}${error?.message ? ` ${error.message}` : ""}`);
    return;
  }

  await loadVideos();
}

async function loadTestimonials() {
  publishedTestimonials.clear();
  if (!testimonialList) {
    return;
  }

  testimonialList.innerHTML = `
    <div class="empty-state">
      Loading testimonials...
    </div>
  `;

  const {
    data: testimonials,
    error
  } = await Content.select(db, "agent_testimonials", "id,title,article,youtube_url,youtube_id,image_urls,thumbnail_url,created_at", query => query.order("created_at", { ascending: false }));

  if (error) {
    console.error("Testimonial load error:", error);

    testimonialList.innerHTML = `
      <div class="empty-state">
        Unable to load testimonials: ${escapeHtml(error.message)}
      </div>
    `;

    return;
  }

  if (!testimonials || testimonials.length === 0) {
    testimonialList.innerHTML = `
      <div class="empty-state">
        No testimonials have been published yet.
      </div>
    `;

    return;
  }

  testimonialList.innerHTML = testimonials.map(testimonial => {
    publishedTestimonials.set(String(testimonial.id), testimonial);
    const thumb = getTestimonialCover(testimonial);

    return `
      <article class="admin-testimonial">

        ${
          thumb
            ? `
              <img
                src="${escapeHtml(thumb)}"
                alt="${escapeHtml(testimonial.title)}"
                loading="lazy"
                decoding="async"
              >
            `
            : `
              <div class="admin-testimonial-thumb">
                P
              </div>
            `
        }

        <div>
          <h3>
            ${escapeHtml(testimonial.title)}
          </h3>

          <p>
            ${escapeHtml(trimWords(testimonial.article, 22))}
          </p>
        </div>

        <div class="admin-actions">
        <button class="edit-post" data-kind="testimonial" data-id="${escapeHtml(testimonial.id)}" type="button">Edit</button>
        <button
          class="delete-testimonial"
          data-id="${testimonial.id}"
          type="button"
        >
          Delete
        </button>
        </div>

      </article>
    `;
  }).join("");

  attachEditButtons(testimonialList);

  document
    .querySelectorAll(".delete-testimonial")
    .forEach(button => {
      button.addEventListener("click", () => {
        deleteTestimonial(button.dataset.id);
      });
    });
}

async function uploadTestimonialImages(files) {
  const fileError = validateContentImages(files, []);
  if (fileError) throw new Error(fileError);
  const imageUrls = [];
  try {
    // Sequential uploads preserve image order and finish before any partial rollback.
    for (const [index, file] of files.entries()) {
      const suffix = file.name.includes(".") ? file.name.split(".").pop().toLowerCase() : "jpg";
      const extension = /^[a-z0-9]{1,10}$/.test(suffix) ? suffix : "jpg";
      const id = crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`;
      const path = `testimonials/${id}.${extension}`;
      const bucket = db.storage.from(TESTIMONIAL_IMAGE_BUCKET);
      const { data } = bucket.getPublicUrl(path);
      if (!data?.publicUrl || getTestimonialImagePath(data.publicUrl) !== path) {
        throw new Error("Unable to generate a valid testimonial image URL.");
      }
      const { error } = await bucket.upload(path, file, {
        cacheControl: "31536000", upsert: false
      });
      if (error) throw new Error(`Unable to upload ${file.name}: ${error.message}`);
      imageUrls.push(data.publicUrl);
    }
    return imageUrls;
  } catch (error) {
    try {
      await removeTestimonialImages(imageUrls);
    } catch (cleanupError) {
      throw new Error(`${error.message} New-image rollback also failed: ${cleanupError.message}. Manual Storage cleanup may be needed.`);
    }
    throw error;
  }
}

function getTestimonialImagePath(value) {
  if (typeof value !== "string" || /[\\\x00-\x20\x7f]/.test(value)) {
    return null;
  }

  try {
    // URL() normalizes dot segments, so reject traversal in the original path first.
    const rawPath = value.match(/^https?:\/\/[^/]+(\/[^?#]*)/i)?.[1];
    if (!rawPath || rawPath.split("/").some(part => [".", ".."].includes(decodeURIComponent(part)))) {
      return null;
    }
    const url = new URL(value);
    const projectUrl = new URL(SUPABASE_URL);
    const prefix =
      `/storage/v1/object/public/${TESTIMONIAL_IMAGE_BUCKET}/`;

    if (
      url.origin !== projectUrl.origin || url.username || url.password ||
      !url.pathname.startsWith(prefix)
    ) {
      return null;
    }

    const path = decodeURIComponent(url.pathname.slice(prefix.length));

    if (
      !path.startsWith("testimonials/") || /[\\%\x00-\x20\x7f]/.test(path) ||
      path.split("/").some(part => !part || part === "." || part === "..")
    ) {
      return null;
    }

    return path;
  } catch {
    return null;
  }
}

async function removeTestimonialImages(imageUrls) {
  const paths = [...new Set(imageUrls.map(getTestimonialImagePath).filter(Boolean))];
  if (!paths.length) return;
  const { error } = await db.storage.from(TESTIMONIAL_IMAGE_BUCKET).remove(paths);
  if (error) throw new Error(`Testimonial Storage cleanup failed: ${error.message}`);
}

async function deleteTestimonial(id) {
  const confirmed =
    window.confirm(
      "Are you sure you want to delete this testimonial?"
    );

  if (!confirmed) {
    return;
  }

  let failureMessage =
    "Unable to load the testimonial for deletion. Nothing was deleted.";

  try {
    const { data: testimonial, error: fetchError } = await db
      .from("agent_testimonials")
      .select("image_urls,thumbnail_url")
      .eq("id", id)
      .single();

    if (fetchError) {
      throw fetchError;
    }

    const imageUrls = Array.isArray(testimonial.image_urls)
      ? testimonial.image_urls
      : [];
    const cleanupUrls = [...imageUrls, testimonial.thumbnail_url];
    const hasImages = cleanupUrls.some(url => getTestimonialImagePath(url));

    if (hasImages) {
      failureMessage =
        "Unable to delete the testimonial images. The testimonial was kept. Check Storage delete permissions and try again.";

      await removeTestimonialImages(cleanupUrls);
    }

    failureMessage = hasImages
      ? "Images were removed, but the testimonial row could not be deleted. Check database delete permissions and retry deletion."
      : "Unable to delete the testimonial row. Check database delete permissions and try again.";

    const { error: deleteError } = await db
      .from("agent_testimonials")
      .delete()
      .eq("id", id)
      .select("id")
      .single();

    if (deleteError) {
      throw deleteError;
    }
  } catch (error) {
    console.error("Testimonial delete error:", error);
    alert(
      `${failureMessage}${error?.message ? ` ${error.message}` : ""}`
    );

    return;
  }

  await loadTestimonials();
}

function getTestimonialCover(testimonial) {
  const thumbnail = typeof testimonial.thumbnail_url === "string" ? testimonial.thumbnail_url.trim() : "";
  const images = Array.isArray(testimonial.image_urls) ? testimonial.image_urls : [];
  // No automatic YouTube covers for newly published posts.
  return thumbnail || images[0] || "";
}

function validateContentImages(images, thumbnails, retainedCount = 0) {
  if (retainedCount + images.length > 10) {
    return `Keep 10 carousel images or fewer. ${retainedCount} existing + ${images.length} new = ${retainedCount + images.length}.`;
  }
  if (thumbnails.length > 1) return "Select only one thumbnail image.";
  if ([...images, ...thumbnails].some(file => !/^image\//i.test(file.type || ""))) {
    return "Select image files only for thumbnails and carousel images.";
  }
  return "";
}

const contentEditor = document.getElementById("content-editor");
const editForm = document.getElementById("content-edit-form");
const editFields = document.getElementById("edit-fields");
const editTitle = document.getElementById("edit-title");
const editArticle = document.getElementById("edit-article");
const editYoutube = document.getElementById("edit-youtube-url");
const editThumbnail = document.getElementById("edit-thumbnail");
const editImages = document.getElementById("edit-images");
const editMessage = document.getElementById("edit-message");
let contentEditState = null;
let editPreviewUrls = [];

function attachEditButtons(container) {
  container.querySelectorAll(".edit-post").forEach(button => {
    button.addEventListener("click", () => openContentEditor(button.dataset.kind, button.dataset.id));
  });
}

function openContentEditor(kind, id) {
  if (contentEditState?.saving) return;
  const post = (kind === "article" ? publishedVideos : publishedTestimonials).get(String(id));
  if (!post) return;
  editForm.reset();
  contentEditState = {
    kind, original: { ...post, image_urls: [...(post.image_urls || [])] },
    retainedImages: [...(post.image_urls || [])], newImages: [], thumbnailMode: "keep", saving: false
  };
  editFields.disabled = false;
  editTitle.value = post.title || "";
  RichText.set(editArticle, post.article || "");
  editYoutube.value = post.youtube_url || (post.youtube_id ? `https://www.youtube.com/watch?v=${encodeURIComponent(post.youtube_id)}` : "");
  document.getElementById("edit-heading").textContent = kind === "article" ? "Edit Article" : "Edit Testimonial";
  editArticle.required = false;
  editMessage.textContent = "";
  renderEditImages();
  if (!contentEditor.open) contentEditor.showModal();
  editTitle.focus({ preventScroll: true });
  contentEditor.scrollTop = 0;
}

function clearEditPreviews() {
  editPreviewUrls.forEach(url => URL.revokeObjectURL(url));
  editPreviewUrls = [];
}

function renderEditImages() {
  if (!contentEditState) return;
  clearEditPreviews();
  const state = contentEditState;
  const preview = (source, alt, remove) => {
    const figure = document.createElement("figure");
    figure.className = "edit-photo";
    const image = document.createElement("img");
    image.src = source;
    image.alt = alt;
    figure.append(image);
    if (remove) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary-button";
      button.textContent = "Remove";
      button.setAttribute("aria-label", `Remove ${alt.toLowerCase()}`);
      button.addEventListener("click", remove);
      figure.append(button);
    }
    return figure;
  };
  const fileUrl = file => {
    const url = URL.createObjectURL(file);
    editPreviewUrls.push(url);
    return url;
  };
  const thumbnail = document.getElementById("edit-thumbnail-preview");
  thumbnail.replaceChildren();
  const thumbnailFile = editThumbnail.files?.[0];
  const thumbnailUrl = state.thumbnailMode === "replace" && thumbnailFile
    ? fileUrl(thumbnailFile)
    : state.thumbnailMode === "keep" ? state.original.thumbnail_url : null;
  if (thumbnailUrl) thumbnail.append(preview(thumbnailUrl, "Thumbnail"));
  document.getElementById("edit-keep-thumbnail").disabled = !state.original.thumbnail_url;

  const existing = document.getElementById("edit-existing-images");
  existing.replaceChildren(...state.retainedImages.map((url, index) => preview(url, `Existing image ${index + 1}`, () => {
    state.retainedImages.splice(index, 1);
    renderEditImages();
  })));
  const added = document.getElementById("edit-new-images");
  added.replaceChildren(...state.newImages.map((file, index) => preview(fileUrl(file), `New image ${index + 1}`, () => {
    state.newImages.splice(index, 1);
    renderEditImages();
  })));
  const total = state.retainedImages.length + state.newImages.length;
  document.getElementById("edit-image-count").textContent = `${total} / 10 images (${state.retainedImages.length} existing, ${state.newImages.length} new)`;
  editMessage.textContent = validateContentImages(state.newImages, Array.from(editThumbnail.files || []), state.retainedImages.length);
}

function closeContentEditor() {
  if (contentEditState?.saving) return;
  clearEditPreviews();
  contentEditState = null;
  editForm.reset();
  contentEditor.close();
}

editThumbnail.addEventListener("change", () => {
  if (!contentEditState) return;
  contentEditState.thumbnailMode = editThumbnail.files.length ? "replace" : "keep";
  renderEditImages();
});
editImages.addEventListener("change", () => {
  if (!contentEditState) return;
  contentEditState.newImages.push(...Array.from(editImages.files || []));
  editImages.value = "";
  renderEditImages();
});
document.getElementById("edit-keep-thumbnail").addEventListener("click", () => {
  if (!contentEditState) return;
  contentEditState.thumbnailMode = "keep";
  editThumbnail.value = "";
  renderEditImages();
});
document.getElementById("edit-remove-thumbnail").addEventListener("click", () => {
  if (!contentEditState) return;
  contentEditState.thumbnailMode = "remove";
  editThumbnail.value = "";
  renderEditImages();
});
document.getElementById("edit-cancel").addEventListener("click", closeContentEditor);
contentEditor.addEventListener("cancel", event => {
  event.preventDefault();
  closeContentEditor();
});
contentEditor.addEventListener("close", () => {
  clearEditPreviews();
  contentEditState = null;
});
editForm.addEventListener("submit", saveContentEdits);

async function persistArticleEdit(original, draft) {
  const uploaded = [];
  let imageUrls;
  let thumbnailUrl;
  try {
    const added = await uploadVideoImages(draft.newImages);
    uploaded.push(...added);
    thumbnailUrl = draft.thumbnailMode === "remove" ? null : original.thumbnail_url || null;
    if (draft.thumbnailMode === "replace") {
      const thumbnails = await uploadVideoImages(draft.thumbnails);
      uploaded.push(...thumbnails);
      thumbnailUrl = thumbnails[0] || null;
    }
    imageUrls = [...draft.retainedImages, ...added];
    const { data, error } = await Content.write(db, "education_videos", {
        title: draft.title, article: draft.article || null,
        youtube_url: draft.youtube_url || null, youtube_id: draft.youtube_id || null,
        image_urls: imageUrls, thumbnail_url: thumbnailUrl
      }, original);
    if (error || !data?.id) throw new Error(`Database update failed: ${error?.message || "No article was updated. Check UPDATE permissions."}`);
  } catch (error) {
    try {
      await removeVideoImages(uploaded);
    } catch (cleanupError) {
      throw new Error(`${error.message} New-image rollback also failed: ${cleanupError.message}. Manual Storage cleanup may be needed.`);
    }
    throw error;
  }

  // Only after the row update succeeds may files no longer referenced by this post be removed.
  const retained = new Set([...imageUrls, thumbnailUrl].map(getVideoImagePath).filter(Boolean));
  const obsolete = [...(original.image_urls || []), original.thumbnail_url]
    .filter(url => getVideoImagePath(url) && !retained.has(getVideoImagePath(url)));
  try {
    await removeVideoImages(obsolete);
    return "";
  } catch (error) {
    return `Changes were saved, but obsolete image cleanup failed: ${error.message}. Manual Storage cleanup may be needed.`;
  }
}

async function persistTestimonialEdit(original, draft) {
  const uploaded = [];
  let imageUrls;
  let thumbnailUrl;
  try {
    const added = await uploadTestimonialImages(draft.newImages);
    uploaded.push(...added);
    thumbnailUrl = draft.thumbnailMode === "remove" ? null : original.thumbnail_url || null;
    if (draft.thumbnailMode === "replace") {
      const thumbnails = await uploadTestimonialImages(draft.thumbnails);
      uploaded.push(...thumbnails);
      thumbnailUrl = thumbnails[0] || null;
    }
    imageUrls = [...draft.retainedImages, ...added];
    const { data, error } = await Content.write(db, "agent_testimonials", {
        title: draft.title, article: draft.article,
        youtube_url: draft.youtube_url || null, youtube_id: draft.youtube_id || null,
        image_urls: imageUrls, thumbnail_url: thumbnailUrl
      }, original);
    if (error || !data?.id) {
      throw new Error(`Database update failed: ${error?.message || "No testimonial was updated. Check UPDATE permissions."}`);
    }
  } catch (error) {
    try {
      await removeTestimonialImages(uploaded);
    } catch (cleanupError) {
      throw new Error(`${error.message} New-image rollback also failed: ${cleanupError.message}. Manual Storage cleanup may be needed.`);
    }
    throw error;
  }

  // Compare validated paths, not URLs: query strings must not turn retained files into deletions.
  const retained = new Set([...imageUrls, thumbnailUrl].map(getTestimonialImagePath).filter(Boolean));
  const obsolete = [...(original.image_urls || []), original.thumbnail_url]
    .filter(url => getTestimonialImagePath(url) && !retained.has(getTestimonialImagePath(url)));
  try {
    await removeTestimonialImages(obsolete);
    return "";
  } catch (error) {
    return `Changes were saved, but obsolete testimonial image cleanup failed: ${error.message}. Manual Storage cleanup may be needed.`;
  }
}

async function saveContentEdits(event) {
  event.preventDefault();
  const state = contentEditState;
  if (!state || state.saving) return;
  const youtubeUrl = editYoutube.value.trim();
  const draft = {
    title: editTitle.value.trim(), article: RichText.read(editArticle),
    youtube_url: youtubeUrl, youtube_id: extractYoutubeId(youtubeUrl),
    retainedImages: [...state.retainedImages], newImages: [...state.newImages],
    thumbnails: Array.from(editThumbnail.files || []), thumbnailMode: state.thumbnailMode
  };
  const fileError = validateContentImages(draft.newImages, draft.thumbnails, draft.retainedImages.length);
  if (!draft.title || fileError) {
    editMessage.textContent = fileError || "Add a title first.";
    return;
  }
  if (youtubeUrl && !isSupportedVideoYoutubeUrl(youtubeUrl, draft.youtube_id)) {
    editMessage.textContent = "Enter a supported YouTube link, or leave it blank.";
    return;
  }
  if (state.kind === "testimonial" && !RichText.text(draft.article)) {
    editMessage.textContent = "Add article text first.";
    return;
  }
  state.saving = true;
  editFields.disabled = true;
  editMessage.textContent = "Saving changes...";
  let warning;
  try {
    warning = state.kind === "testimonial"
      ? await persistTestimonialEdit(state.original, draft)
      : await persistArticleEdit(state.original, draft);
    if (state.kind === "testimonial") {
      try {
        await loadTestimonials();
      } catch {
        warning = `${warning || "Testimonial changes saved successfully."} Reload the page to refresh the published list.`;
      }
    }
  } catch (error) {
    editMessage.textContent = `Unable to save changes. ${error.message}`;
    return;
  } finally {
    state.saving = false;
    editFields.disabled = false;
  }
  closeContentEditor();
  if (state.kind === "testimonial") {
    testimonialMessage.textContent = warning || "Testimonial changes saved successfully.";
    return;
  }
  messageBox.textContent = warning || "Article changes saved successfully.";
  try {
    await loadVideos();
  } catch {
    messageBox.textContent += " Reload the page to refresh the published list.";
  }
}

function extractYoutubeId(url) {
  if (!url) {
    return "";
  }

  try {
    const parsed = new URL(url);

    if (parsed.hostname.includes("youtu.be")) {
      return parsed.pathname.slice(1);
    }

    if (parsed.searchParams.get("v")) {
      return parsed.searchParams.get("v");
    }

    const embedMatch =
      parsed.pathname.match(/\/embed\/([^/]+)/);

    return embedMatch ? embedMatch[1] : "";
  } catch {
    return "";
  }
}

function trimWords(value, limit) {
  const words =
    RichText.text(value)
      .trim()
      .split(/\s+/)
      .filter(Boolean);

  if (words.length <= limit) {
    return words.join(" ");
  }

  return `${words.slice(0, limit).join(" ")}...`;
}

logoutButton.addEventListener(
  "click",
  async () => {
    await db.auth.signOut();

    window.location.href =
      "login.html";
  }
);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

RichText.mount();
initializeAdmin();

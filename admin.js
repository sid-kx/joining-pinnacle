const form = document.getElementById("video-form");
const urlInput = document.getElementById("youtube-url");
const videoTitle = document.getElementById("video-title");
const videoArticle = document.getElementById("video-article");
const videoImages = document.getElementById("video-images");
const messageBox = document.getElementById("admin-message");
const list = document.getElementById("admin-video-list");
const logoutButton = document.getElementById("logout");
const testimonialForm = document.getElementById("testimonial-form");
const testimonialTitle = document.getElementById("testimonial-title");
const testimonialArticle = document.getElementById("testimonial-article");
const testimonialYoutubeUrl = document.getElementById("testimonial-youtube-url");
const testimonialImages = document.getElementById("testimonial-images");
const testimonialMessage = document.getElementById("testimonial-message");
const testimonialList = document.getElementById("admin-testimonial-list");

const TESTIMONIAL_IMAGE_BUCKET = "testimonial-images";
const VIDEO_IMAGE_BUCKET = "video-images";

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
  list.innerHTML = `
    <div class="empty-state">
      Loading videos...
    </div>
  `;

  const {
    data: videos,
    error
  } = await db
    .from("education_videos")
    .select(`
      id,
      youtube_id,
      youtube_url,
      title,
      article,
      image_urls,
      thumbnail_url,
      created_at
    `)
    .order("created_at", {
      ascending: false
    });

  if (error) {
    console.error("Video load error:", error);

    list.innerHTML = `
      <div class="empty-state">
        Unable to load videos: ${escapeHtml(error.message)}
      </div>
    `;

    return;
  }

  if (!videos || videos.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        No videos have been published yet.
      </div>
    `;

    return;
  }

  list.innerHTML = videos.map(video => {
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

        ${video.youtube_url ? `<a
          href="${escapeHtml(video.youtube_url)}"
          target="_blank"
          rel="noopener"
        >
          View on YouTube ↗
        </a>` : ""}

      </div>

      <button
        class="delete-video"
        data-id="${video.id}"
        type="button"
      >
        Delete
      </button>

    </article>
  `;
  }).join("");

  document
    .querySelectorAll(".delete-video")
    .forEach(button => {
      button.addEventListener("click", () => {
        deleteVideo(button.dataset.id);
      });
    });
}

function getVideoCover(video) {
  const firstImage = Array.isArray(video.image_urls) ? video.image_urls[0] : null;
  if (typeof firstImage === "string" && firstImage.trim()) {
    return firstImage;
  }
  // thumbnail_url is supported only for existing rows during migration.
  return typeof video.thumbnail_url === "string" ? video.thumbnail_url.trim() : "";
}

function getVideoContentDraft() {
  const youtubeUrl = urlInput.value.trim();

  return {
    title: videoTitle.value.trim(),
    article: videoArticle.value.trim(),
    youtube_url: youtubeUrl || null,
    youtube_id: extractYoutubeId(youtubeUrl) || null,
    images: Array.from(videoImages.files || [])
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
  messageBox.textContent = "Publishing video...";

  let imageUrls = [];
  let publishedId;

  try {
    imageUrls = await uploadVideoImages(draft.images);

    const { data, error } = await db
      .from("education_videos")
      .insert({
        title: draft.title,
        article: draft.article || null,
        youtube_url: draft.youtube_url,
        youtube_id: draft.youtube_id,
        image_urls: imageUrls,
        thumbnail_url: null
      })
      .select("id")
      .single();

    if (error) {
      throw new Error(`Database insert failed: ${error.message}`);
    }
    if (!data?.id) {
      throw new Error("Database insert did not return a video ID.");
    }
    publishedId = data.id;
  } catch (error) {
    let message = error?.message || "Unable to publish the video.";
    if (imageUrls.length) {
      try {
        await removeVideoImages(imageUrls);
      } catch (cleanupError) {
        message += ` Image rollback also failed: ${cleanupError.message}. Uploaded images may need manual cleanup.`;
      }
    }
    console.error("Video publishing failed:", error);
    messageBox.textContent = `Video was not published. ${message}`;
    return;
  } finally {
    videoPublishing = false;
    submitButton.disabled = false;
  }

  messageBox.textContent = `Video published successfully. Database ID: ${publishedId}`;
  form.reset();
  try {
    await loadVideos();
  } catch (error) {
    messageBox.textContent += " Unable to refresh the list. Reload to see the published video.";
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

if (testimonialForm) {
  testimonialForm.addEventListener("submit", async event => {
    event.preventDefault();

    const title = testimonialTitle.value.trim();
    const article = testimonialArticle.value.trim();
    const youtubeUrl = testimonialYoutubeUrl.value.trim();
    const files = Array.from(testimonialImages.files || []);

    if (!title || !article) {
      testimonialMessage.textContent =
        "Add a title and article first.";
      return;
    }

    if (files.length > 10) {
      testimonialMessage.textContent =
        "Upload 10 images or fewer.";
      return;
    }

    testimonialMessage.textContent =
      "Adding testimonial...";

    try {
      const imageUrls =
        await uploadTestimonialImages(files);

      const {
        data,
        error
      } = await db
        .from("agent_testimonials")
        .insert({
          title,
          article,
          youtube_url: youtubeUrl || null,
          youtube_id: extractYoutubeId(youtubeUrl) || null,
          image_urls: imageUrls
        })
        .select("id")
        .single();

      if (error) {
        console.error("Testimonial insert error:", error);

        testimonialMessage.textContent =
          `Unable to add testimonial: ${error.message}`;
        return;
      }

      testimonialMessage.textContent =
        `Testimonial added. Database ID: ${data.id}`;

      testimonialForm.reset();

      await loadTestimonials();
    } catch (error) {
      console.error("Unexpected testimonial error:", error);

      testimonialMessage.textContent =
        error?.message ||
        "Unexpected error while adding the testimonial.";
    }
  });
}

async function deleteVideo(id) {
  const confirmed = window.confirm("Are you sure you want to delete this video?");
  if (!confirmed) {
    return;
  }

  let failureMessage = "Unable to load the video for deletion. Nothing was deleted.";

  try {
    const { data: video, error: fetchError } = await db
      .from("education_videos")
      .select("image_urls")
      .eq("id", id)
      .single();

    if (fetchError) {
      throw fetchError;
    }

    const imageUrls = Array.isArray(video.image_urls)
      ? video.image_urls.filter(url => getVideoImagePath(url))
      : [];

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
  } = await db
    .from("agent_testimonials")
    .select(`
      id,
      title,
      article,
      youtube_url,
      youtube_id,
      image_urls,
      created_at
    `)
    .order("created_at", {
      ascending: false
    });

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
    const images =
      Array.isArray(testimonial.image_urls)
        ? testimonial.image_urls
        : [];

    const thumb =
      images[0] ||
      getYoutubeThumbnail(testimonial.youtube_id) ||
      "";

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

        <button
          class="delete-testimonial"
          data-id="${testimonial.id}"
          type="button"
        >
          Delete
        </button>

      </article>
    `;
  }).join("");

  document
    .querySelectorAll(".delete-testimonial")
    .forEach(button => {
      button.addEventListener("click", () => {
        deleteTestimonial(button.dataset.id);
      });
    });
}

async function uploadTestimonialImages(files) {
  if (files.length === 0) {
    return [];
  }

  const uploads =
    files.slice(0, 10).map(async (file, index) => {
      const extension =
        file.name.includes(".")
          ? file.name.split(".").pop().toLowerCase()
          : "jpg";

      const id =
        crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${index}`;

      const path =
        `testimonials/${id}.${extension}`;

      const {
        error
      } = await db.storage
        .from(TESTIMONIAL_IMAGE_BUCKET)
        .upload(path, file, {
          cacheControl: "31536000",
          upsert: false
        });

      if (error) {
        throw new Error(
          `Unable to upload ${file.name}: ${error.message}`
        );
      }

      const {
        data
      } = db.storage
        .from(TESTIMONIAL_IMAGE_BUCKET)
        .getPublicUrl(path);

      return data.publicUrl;
    });

  return Promise.all(uploads);
}

function getTestimonialImagePath(value) {
  if (typeof value !== "string") {
    return null;
  }

  try {
    const url = new URL(value);
    const projectUrl = new URL(SUPABASE_URL);
    const prefix =
      `/storage/v1/object/public/${TESTIMONIAL_IMAGE_BUCKET}/`;

    if (
      url.origin !== projectUrl.origin ||
      !url.pathname.startsWith(prefix)
    ) {
      return null;
    }

    const path = decodeURIComponent(url.pathname.slice(prefix.length));

    if (
      /[\\\x00-\x1f\x7f]/.test(path) ||
      path.split("/").some(part => !part || part === "." || part === "..")
    ) {
      return null;
    }

    return path;
  } catch {
    return null;
  }
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
      .select("image_urls")
      .eq("id", id)
      .single();

    if (fetchError) {
      throw fetchError;
    }

    const imageUrls = Array.isArray(testimonial.image_urls)
      ? testimonial.image_urls
      : [];
    const paths = [...new Set(
      imageUrls.map(getTestimonialImagePath).filter(Boolean)
    )];

    if (paths.length > 0) {
      failureMessage =
        "Unable to delete the testimonial images. The testimonial was kept. Check Storage delete permissions and try again.";

      const { error: storageError } = await db.storage
        .from(TESTIMONIAL_IMAGE_BUCKET)
        .remove(paths);

      if (storageError) {
        throw storageError;
      }
    }

    failureMessage = paths.length > 0
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

function getYoutubeThumbnail(id) {
  return id
    ? `https://img.youtube.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`
    : "";
}

function trimWords(value, limit) {
  const words =
    String(value || "")
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

initializeAdmin();

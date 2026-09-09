const form = document.getElementById("video-form");
const urlInput = document.getElementById("youtube-url");
const messageBox = document.getElementById("admin-message");
const list = document.getElementById("admin-video-list");
const logoutButton = document.getElementById("logout");

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

  await loadVideos();
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

  list.innerHTML = videos.map(video => `
    <article class="admin-video">

      <img
        src="${escapeHtml(video.thumbnail_url)}"
        alt="${escapeHtml(video.title)}"
      >

      <div>

        <h3>
          ${escapeHtml(video.title)}
        </h3>

        <a
          href="${escapeHtml(video.youtube_url)}"
          target="_blank"
          rel="noopener"
        >
          View on YouTube ↗
        </a>

      </div>

      <button
        class="delete-video"
        data-id="${video.id}"
        type="button"
      >
        Delete
      </button>

    </article>
  `).join("");

  document
    .querySelectorAll(".delete-video")
    .forEach(button => {
      button.addEventListener("click", () => {
        deleteVideo(button.dataset.id);
      });
    });
}

form.addEventListener("submit", async event => {
  event.preventDefault();

  const url = urlInput.value.trim();

  if (!url) {
    messageBox.textContent =
      "Paste a YouTube URL first.";
    return;
  }

  messageBox.textContent =
    "Adding video...";

  try {
    const {
      data,
      error
    } = await db.functions.invoke(
      "dynamic-processor",
      {
        body: { url }
      }
    );

    if (error) {
      console.error(
        "Edge Function error:",
        error
      );

      let message =
        error.message ||
        "Unable to add video.";

      try {
        if (error.context) {
          const body =
            await error.context.json();

          if (body?.error) {
            message = body.error;
          }
        }
      } catch (parseError) {
        console.error(
          "Could not parse function error response:",
          parseError
        );
      }

      messageBox.textContent =
        message;

      return;
    }

    console.log(
      "Edge Function response:",
      data
    );

    if (data?.error) {
      messageBox.textContent =
        data.error;
      return;
    }

    if (
      !data?.success ||
      !data?.video ||
      !data.video.id
    ) {
      console.error(
        "Function did not return an inserted video:",
        data
      );

      messageBox.textContent =
        "The function ran, but did not confirm a database insert.";

      return;
    }

    messageBox.textContent =
      `Video added successfully. Database ID: ${data.video.id}`;

    urlInput.value = "";

    await loadVideos();

  } catch (error) {
    console.error(
      "Unexpected add-video error:",
      error
    );

    messageBox.textContent =
      error?.message ||
      "Unexpected error while adding the video.";
  }
});

async function deleteVideo(id) {
  const confirmed =
    window.confirm(
      "Are you sure you want to delete this video?"
    );

  if (!confirmed) {
    return;
  }

  const {
    error
  } = await db
    .from("education_videos")
    .delete()
    .eq("id", id);

  if (error) {
    console.error(
      "Delete error:",
      error
    );

    alert(
      `Unable to delete the video: ${error.message}`
    );

    return;
  }

  await loadVideos();
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
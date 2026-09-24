(function (global) {
  "use strict";
function extractYoutubeId(url) {
  if (typeof url !== "string" || !url.trim()) {
    return "";
  }

  try {
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) {
      return "";
    }
    // Normalize one optional trailing slash without discarding extra path segments.
    const pathname = parsed.pathname.replace(/\/$/, "");
    let id = "";
    if (["youtu.be", "www.youtu.be"].includes(parsed.hostname)) {
      id = pathname.slice(1);
    } else if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(parsed.hostname)) {
      id = pathname === "/watch"
        ? parsed.searchParams.get("v") || ""
        : pathname.match(/^\/(?:embed|shorts)\/([A-Za-z0-9_-]{11})$/)?.[1] || "";
    } else if (["youtube-nocookie.com", "www.youtube-nocookie.com"].includes(parsed.hostname)) {
      id = pathname.match(/^\/embed\/([A-Za-z0-9_-]{11})$/)?.[1] || "";
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : "";
  } catch {
    return "";
  }
}

  const validId = value => typeof value === "string" && /^[A-Za-z0-9_-]{11}$/.test(value);
  const idFromPost = post => validId(post.youtube_id) ? post.youtube_id : extractYoutubeId(post.youtube_url);
  global.YouTube = { extractId: extractYoutubeId, validId, idFromPost };
})(window);

const articleContent = document.getElementById("article-content");
const articleStatus = document.getElementById("article-status");
const articleMedia = document.getElementById("article-media");

function articleElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function renderArticleCarousel(images, title) {
  const carousel = articleElement("section", "testimonial-carousel");
  carousel.setAttribute("aria-label", "Article photos");
  carousel.setAttribute("aria-roledescription", "carousel");
  const stage = articleElement("div", "testimonial-carousel-stage");
  const photo = articleElement("img");
  photo.decoding = "async";
  stage.append(photo);
  const controls = articleElement("div", "testimonial-carousel-controls");
  const counter = articleElement("span", "testimonial-carousel-counter");
  counter.setAttribute("role", "status");
  counter.setAttribute("aria-live", "polite");
  counter.setAttribute("aria-atomic", "true");
  let index = 0;
  const showPhoto = () => {
    photo.src = images[index];
    photo.alt = `${title} image ${index + 1}`;
    counter.textContent = `${index + 1} / ${images.length}`;
  };
  const arrow = (step, label, symbol) => {
    const button = articleElement("button", "", symbol);
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.title = label;
    button.addEventListener("click", () => {
      index = (index + step + images.length) % images.length;
      showPhoto();
    });
    return button;
  };
  if (images.length > 1) controls.append(arrow(-1, "Previous photo", "\u2190"));
  controls.append(counter);
  if (images.length > 1) controls.append(arrow(1, "Next photo", "\u2192"));
  carousel.append(stage, controls);
  showPhoto();
  return carousel;
}

function renderArticle(article) {
  const title = article.title || "Pinnacle Education";
  document.getElementById("article-title").textContent = title;
  articleMedia.replaceChildren();
  const youtubeId = getEducationYoutubeId(article);
  if (youtubeId) {
    const player = articleElement("div", "testimonial-video");
    const iframe = articleElement("iframe");
    iframe.src = `https://www.youtube.com/embed/${encodeURIComponent(youtubeId)}?rel=0`;
    iframe.title = title;
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    iframe.allowFullscreen = true;
    player.append(iframe);
    articleMedia.append(player);
  }
  const images = Array.isArray(article.image_urls)
    ? article.image_urls.filter(url => typeof url === "string" && url.trim()).slice(0, 10)
    : [];
  if (images.length) articleMedia.append(renderArticleCarousel(images, title));

  const body = document.getElementById("article-body");
  body.replaceChildren();
  const text = typeof article.article === "string" ? article.article.trim() : "";
  if (text) {
    text.split(/\r?\n\s*\r?\n/).forEach(paragraph => {
      body.append(articleElement("p", "", paragraph));
    });
  }
  const date = document.getElementById("article-date");
  const published = new Date(article.created_at);
  date.hidden = !article.created_at || Number.isNaN(published.getTime());
  if (!date.hidden) {
    date.dateTime = published.toISOString();
    date.textContent = new Intl.DateTimeFormat("en-CA", { dateStyle: "long" }).format(published);
  }
  updateArticleMetadata(article, text, images);
  articleStatus.hidden = true;
  articleContent.hidden = false;
}

function updateArticleMetadata(article, text, images) {
  // Browser-only metadata for this template. Static generation must emit it in raw HTML later.
  const title = article.title || "Pinnacle Education";
  const description = (text || title).replace(/\s+/g, " ").slice(0, 160);
  document.title = `${title} | Pinnacle Realty`;
  const meta = (attribute, key, value) => {
    let element = document.head.querySelector(`meta[${attribute}="${key}"]`);
    if (!element) {
      element = document.createElement("meta");
      element.setAttribute(attribute, key);
      document.head.append(element);
    }
    element.content = value;
  };
  meta("name", "description", description);
  meta("property", "og:title", title);
  meta("property", "og:description", description);
  meta("property", "og:type", "article");
  const cover = article.thumbnail_url || images[0];
  if (cover) meta("property", "og:image", cover);

  const url = new URL("article.html", window.location.href);
  url.searchParams.set("id", article.id);
  const canonical = document.head.querySelector('link[rel="canonical"]') || document.createElement("link");
  canonical.rel = "canonical";
  canonical.href = url.href;
  document.head.append(canonical);
  meta("property", "og:url", url.href);
  const structured = document.getElementById("article-structured-data") || document.createElement("script");
  structured.id = "article-structured-data";
  structured.type = "application/ld+json";
  const data = { "@context": "https://schema.org", "@type": "Article", headline: title, description, url };
  if (cover) data.image = [cover];
  if (article.created_at && !Number.isNaN(Date.parse(article.created_at))) data.datePublished = article.created_at;
  structured.textContent = JSON.stringify(data);
  document.head.append(structured);
}

async function loadArticle() {
  const id = new URLSearchParams(window.location.search).get("id");
  if (!id) {
    articleStatus.textContent = "No article selected. Return to Education to choose an article.";
    return;
  }
  try {
    const { data, error } = await db.from("education_videos")
      .select("id,title,article,youtube_url,youtube_id,image_urls,thumbnail_url,created_at")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      articleStatus.textContent = "Article not found. It may have been removed.";
      return;
    }
    renderArticle(data);
  } catch (error) {
    console.error("Unable to load article:", error);
    articleStatus.textContent = "Unable to load this article. Please try again later.";
  }
}

function getEducationYoutubeId(video) {
  if (video.youtube_id) {
    return video.youtube_id;
  }
  try {
    const url = new URL(video.youtube_url);
    const parts = url.pathname.split("/").filter(Boolean);
    if (url.hostname === "youtu.be" || url.hostname === "www.youtu.be") {
      return parts[0] || "";
    }
    if (["youtube.com", "www.youtube.com", "m.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"].includes(url.hostname)) {
      return url.searchParams.get("v") ||
        (["embed", "shorts", "live"].includes(parts[0]) ? parts[1] || "" : "");
    }
  } catch {
    return "";
  }
  return "";
}

loadArticle();

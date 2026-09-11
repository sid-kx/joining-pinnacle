const articleContent = document.getElementById("article-content");
const articleStatus = document.getElementById("article-status");
const articleMedia = document.getElementById("article-media");
const pageKind = document.body.dataset.contentKind || "article";
const pageLabel = pageKind === "testimonial" ? "Testimonial" : "Article";

function articleElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function renderArticleCarousel(images, title) {
  const carousel = articleElement("section", "testimonial-carousel");
  carousel.setAttribute("aria-label", `${pageLabel} photos`);
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
  body.innerHTML = RichText.toHTML(article.article);
  const text = RichText.text(article.article);
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
  // The static build runs this same renderer to include metadata in the initial HTML.
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

  const url = Content.validSlug(article.slug) ? Content.origin + Content.path(pageKind, article.slug) : null;
  if (url) {
    const canonical = document.head.querySelector('link[rel="canonical"]') || document.createElement("link");
    canonical.rel = "canonical";
    canonical.href = url;
    document.head.append(canonical);
    meta("property", "og:url", url);
  }
  const structured = document.getElementById("article-structured-data") || document.createElement("script");
  structured.id = "article-structured-data";
  structured.type = "application/ld+json";
  const data = { "@context": "https://schema.org", "@type": "Article", headline: title, description };
  if (pageKind === "article") data.author = { "@type": "Person", name: "Jag Saini", jobTitle: "Broker of Record" };
  if (url) data.url = url;
  if (cover) data.image = [cover];
  if (article.created_at && !Number.isNaN(Date.parse(article.created_at))) data.datePublished = article.created_at;
  structured.textContent = JSON.stringify(data).replace(/</g, "\\u003c");
  document.head.append(structured);
}

async function loadArticle() {
  if (window.__BUILD_POST__) { renderArticle(window.__BUILD_POST__); return; }
  const params = new URLSearchParams(window.location.search);
  const match = window.location.pathname.match(/^\/(articles|testimonials)\/([a-z0-9-]+)\/?$/);
  const slug = match?.[2] || params.get("slug");
  const id = params.get("id");
  if ((!slug && !id) || (slug && !Content.validSlug(slug))) {
    articleStatus.textContent = `No ${pageKind} selected. Use the back link to choose a post.`;
    return;
  }
  const snapshot = document.getElementById("post-snapshot");
  if (snapshot) {
    try { const post = JSON.parse(snapshot.textContent); if (post.slug === slug) renderArticle(post); } catch { /* Fetch below remains authoritative. */ }
  }
  try {
    const table = pageKind === "testimonial" ? "agent_testimonials" : "education_videos";
    if (slug && !(await Content.supportsSlugs(db, table))) throw new Error("Slug migration is not yet available.");
    const { data, error } = await Content.select(db, table,
      "id,title,article,youtube_url,youtube_id,image_urls,thumbnail_url,created_at",
      query => query.eq(slug ? "slug" : "id", slug || id).maybeSingle());
    if (error) throw error;
    if (!data) {
      articleContent.hidden = true;
      articleStatus.hidden = false;
      articleStatus.textContent = `${pageLabel} not found. It may have been removed.`;
      return;
    }
    if (Content.validSlug(data.slug) && !match) {
      await Content.loadRoutes();
      const target = Content.url(pageKind, data);
      if (target !== window.location.pathname + window.location.search) { window.location.replace(target); return; }
    }
    renderArticle(data);
  } catch (error) {
    console.error("Unable to load article:", error);
    articleStatus.hidden = false;
    articleStatus.textContent = `Unable to refresh this ${pageKind}. Please try again later.`;
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

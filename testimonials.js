(function (global) {
  "use strict";
  const wrap = (index, count) => count ? ((index % count) + count) % count : 0;
  const swipeStep = (dx, dy) => Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.3 ? (dx < 0 ? 1 : -1) : 0;
  let youtubeApi;
  function loadYouTubeApi() {
    if (global.YT?.Player) return Promise.resolve(global.YT);
    if (!youtubeApi) youtubeApi = new Promise((resolve, reject) => {
      const previous = global.onYouTubeIframeAPIReady;
      global.onYouTubeIframeAPIReady = () => {
        resolve(global.YT);
        if (typeof previous === "function") previous();
      };
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => {
        script.remove();
        youtubeApi = null;
        global.onYouTubeIframeAPIReady = previous;
        reject(new Error("YouTube playback controls could not load."));
      };
      document.head.append(script);
    });
    return youtubeApi;
  }

  class Gallery {
    constructor(root) {
      this.root = root;
      this.grid = root.querySelector("#testimonial-grid");
      this.mobile = root.querySelector("#testimonial-mobile");
      this.track = root.querySelector("#testimonial-track");
      this.more = root.querySelector("#testimonial-more");
      this.state = root.querySelector("#testimonial-state");
      this.navigation = root.querySelector("#testimonial-navigation");
      this.position = root.querySelector("#testimonial-position");
      this.media = matchMedia("(max-width:900px)");
      this.items = [];
      this.index = 0;
      this.visible = 3;
      this.active = null;
      this.moving = false;
      this.more.addEventListener("click", () => {
        const start = this.visible;
        this.visible += 3;
        this.items.slice(start, this.visible).forEach((post, offset) => this.grid.append(this.card(post, start + offset)));
        this.more.hidden = this.visible >= this.items.length;
      });
      root.querySelector("#testimonial-prev").addEventListener("click", () => this.move(-1));
      root.querySelector("#testimonial-next").addEventListener("click", () => this.move(1));
      this.track.addEventListener("keydown", event => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        if (this.items.length < 2) return;
        event.preventDefault();
        this.move(event.key === "ArrowRight" ? 1 : -1);
      });
      this.track.addEventListener("pointerdown", event => {
        if (!event.isPrimary || event.button !== 0) return;
        this.suppressClick = false;
        clearTimeout(this.clickTimer);
        if (this.items.length < 2 || this.moving) return;
        this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
        // Capture only edge-zone gestures, never taps intended for the poster/player.
        if (event.target.classList.contains("testimonial-swipe-zone")) event.target.setPointerCapture?.(event.pointerId);
      });
      this.track.addEventListener("pointermove", event => {
        if (!this.pointer || this.pointer.id !== event.pointerId) return;
        const dx = event.clientX - this.pointer.x;
        const dy = event.clientY - this.pointer.y;
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
          this.pointer = null;
          return;
        }
        if (swipeStep(dx, dy) && event.cancelable) event.preventDefault();
      });
      this.track.addEventListener("pointerup", event => {
        if (!this.pointer || this.pointer.id !== event.pointerId) return;
        const step = swipeStep(event.clientX - this.pointer.x, event.clientY - this.pointer.y);
        this.pointer = null;
        if (step) {
          this.suppressClick = true;
          clearTimeout(this.clickTimer);
          this.clickTimer = setTimeout(() => { this.suppressClick = false; }, 350);
          this.move(step);
        }
      });
      this.track.addEventListener("pointercancel", () => { this.pointer = null; });
      this.track.addEventListener("click", event => {
        if (this.suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); }
      }, true);
      this.media.addEventListener("change", () => this.render());
    }

    setItems(rows) {
      this.items = (Array.isArray(rows) ? rows : []).map(row => ({ ...row, youtube_id: YouTube.idFromPost(row) }))
        .filter(row => {
          if (row.youtube_id) return true;
          console.warn("Skipping testimonial without a valid YouTube video:", row.id);
          return false;
        })
        .sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
      this.index = 0;
      this.visible = 3;
      this.render();
    }

    stop() {
      if (!this.active) return;
      const { card, post, index, preview, player } = this.active;
      this.active = null;
      // Removing the iframe stops playback even if the API is unavailable/not ready.
      try { player?.destroy(); } catch { /* The DOM removal below is authoritative. */ }
      card.replaceWith(this.card(post, index, preview));
    }

    async startMobilePlayer(session, iframe) {
      try {
        const api = await loadYouTubeApi();
        if (this.active !== session) return;
        session.player = new api.Player(iframe, { events: {
          onReady: event => {
            if (this.active !== session) { event.target.destroy(); return; }
            if (!session.mutedRetry) {
              event.target.unMute();
              event.target.setVolume(100);
            }
            event.target.playVideo();
          },
          onAutoplayBlocked: event => {
            if (this.active !== session || session.mutedRetry) return;
            session.mutedRetry = true;
            // Mobile policies may refuse sound; retry playback once without it.
            event.target.mute();
            event.target.playVideo();
          }
        } });
      } catch (error) {
        console.warn("Testimonial playback request unavailable; native controls remain usable:", error);
      }
    }

    card(post, index, preview = "") {
      const card = document.createElement("div");
      card.className = "testimonial-clip" + (preview ? " testimonial-" + preview : "");
      card.dataset.videoId = post.youtube_id;
      const play = document.createElement("button");
      play.type = "button";
      play.className = "testimonial-poster";
      play.setAttribute("aria-label", preview === "previous" ? "Previous testimonial" : preview === "next" ? "Next testimonial" : `Play testimonial ${index + 1}`);
      const image = document.createElement("img");
      image.src = `https://i.ytimg.com/vi/${post.youtube_id}/hqdefault.jpg`;
      image.alt = "";
      image.draggable = false;
      image.loading = "lazy";
      image.decoding = "async";
      image.addEventListener("error", () => { image.hidden = true; });
      play.append(image);
      if (!preview) {
        const icon = document.createElement("span");
        icon.className = "testimonial-play";
        icon.textContent = "\u25b6";
        icon.setAttribute("aria-hidden", "true");
        play.append(icon);
      } else play.tabIndex = -1;
      play.addEventListener("click", () => {
        if (this.moving) return;
        if (preview) { this.move(preview === "previous" ? -1 : 1); return; }
        this.stop();
        const iframe = document.createElement("iframe");
        // Autoplay is requested only after a deliberate play click, never on page load.
        iframe.src = `https://www.youtube.com/embed/${post.youtube_id}?autoplay=1&playsinline=1&rel=0`;
        if (this.media.matches) iframe.src += `&enablejsapi=1&origin=${encodeURIComponent(global.location.origin)}`;
        iframe.title = `Agent testimonial ${index + 1}`;
        iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
        iframe.allowFullscreen = true;
        iframe.referrerPolicy = "strict-origin-when-cross-origin";
        card.replaceChildren(iframe);
        const session = this.active = { card, post, index, preview };
        if (this.media.matches) {
          if (this.items.length > 1) {
            for (const side of ["left", "right"]) {
              const zone = document.createElement("div");
              zone.className = `testimonial-swipe-zone testimonial-swipe-zone--${side}`;
              zone.setAttribute("aria-hidden", "true");
              card.append(zone);
            }
          }
          this.startMobilePlayer(session, iframe);
        }
        iframe.focus({ preventScroll: true });
      });
      card.append(play);
      return card;
    }

    render() {
      clearTimeout(this.timer);
      this.pointer = null;
      this.moving = false;
      this.stop();
      this.track.classList.remove("moving-next", "moving-previous");
      this.grid.replaceChildren();
      this.track.replaceChildren();
      const mobile = this.media.matches;
      this.grid.hidden = mobile;
      this.mobile.hidden = !mobile || !this.items.length;
      this.state.hidden = Boolean(this.items.length);
      this.state.textContent = "Testimonials coming soon.";
      this.more.hidden = mobile || this.items.length <= this.visible;
      if (mobile) this.renderSlides();
      else this.items.slice(0, this.visible).forEach((post, index) => this.grid.append(this.card(post, index)));
    }

    renderSlides() {
      this.track.replaceChildren();
      const count = this.items.length;
      if (!count) return;
      // Three fixed slots; for two items both peeks describe the same neighbor.
      if (count > 1) {
        const previous = wrap(this.index - 1, count);
        this.track.append(this.card(this.items[previous], previous, "previous"));
      }
      this.track.append(this.card(this.items[this.index], this.index));
      if (count > 1) {
        const next = wrap(this.index + 1, count);
        this.track.append(this.card(this.items[next], next, "next"));
      }
      this.navigation.hidden = count < 2;
      this.track.tabIndex = count > 1 ? 0 : -1;
      this.position.textContent = `${this.index + 1} / ${count}`;
    }

    move(step) {
      if (!this.media.matches || this.items.length < 2 || this.moving) return;
      this.stop();
      this.moving = true;
      const focusedInside = this.track.contains(document.activeElement);
      this.track.classList.add(step > 0 ? "moving-next" : "moving-previous");
      const finish = () => {
        this.index = wrap(this.index + step, this.items.length);
        this.renderSlides();
        this.track.classList.remove("moving-next", "moving-previous");
        this.moving = false;
        if (focusedInside) this.track.focus({ preventScroll: true });
      };
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) finish();
      else this.timer = setTimeout(finish, 220);
    }

    async load(db) {
      try {
        const { data, error } = await db.from("agent_testimonials")
          .select("id,youtube_url,youtube_id,created_at").order("created_at", { ascending: false });
        if (error) throw error;
        this.setItems(data);
      } catch (error) {
        console.warn("Unable to load testimonials:", error);
        this.setItems([]);
      }
    }
  }
  global.TestimonialGallery = { Gallery, wrap, swipeStep };
  const root = document.getElementById("testimonial-gallery");
  if (root && global.db) new Gallery(root).load(global.db);
})(window);

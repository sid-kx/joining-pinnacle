(function (global) {
  "use strict";
  const wrap = (index, count) => count ? ((index % count) + count) % count : 0;
  const swipeStep = (dx, dy) => Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.3 ? (dx < 0 ? 1 : -1) : 0;

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
        if (!event.isPrimary || event.button !== 0 || this.items.length < 2 || this.moving) return;
        this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
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
      const { card, post, index, preview } = this.active;
      this.active = null;
      card.replaceWith(this.card(post, index, preview));
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
        iframe.title = `Agent testimonial ${index + 1}`;
        iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
        iframe.allowFullscreen = true;
        iframe.referrerPolicy = "strict-origin-when-cross-origin";
        card.replaceChildren(iframe);
        this.active = { card, post, index, preview };
        iframe.focus({ preventScroll: true });
      });
      card.append(play);
      return card;
    }

    render() {
      clearTimeout(this.timer);
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

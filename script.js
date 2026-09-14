const menuBtn = document.querySelector(".menu-btn");
const mobileMenu = document.querySelector(".mobile-menu");
const header = document.querySelector(".site-header");

const heroPlayer = document.getElementById("hero-vsl-player");
const heroStart = document.querySelector(".hero-vsl-start");

if (heroPlayer && heroStart) {
  const frame = heroPlayer.closest(".hero-vsl");
  const status = document.getElementById("hero-vsl-status");
  let started = false;
  let starting = false;

  function finishHeroStart() {
    if (started) return;
    started = true;
    frame.classList.remove("is-unstarted");
    heroPlayer.removeAttribute("inert");
    if (document.activeElement === heroStart) heroPlayer.focus({ preventScroll: true });
    heroStart.hidden = true;
    status.textContent = "";
  }

  async function startHeroVideo() {
    if (started || starting) return;
    // Keep play() in the user gesture; an unloaded component requires a fresh tap.
    if (typeof heroPlayer.play !== "function") {
      status.textContent = "Video is still loading. Please try again in a moment.";
      return;
    }
    starting = true;
    heroStart.disabled = true;
    status.textContent = "";
    try {
      heroPlayer.muted = false;
      heroPlayer.volume = 1;
      await heroPlayer.play();
      finishHeroStart();
    } catch (error) {
      if (!started) status.textContent = "Unable to start the video. Please try again.";
      console.error("Unable to start hero video:", error);
    } finally {
      starting = false;
      heroStart.disabled = false;
    }
  }

  heroPlayer.addEventListener("playing", finishHeroStart, { once: true });
  heroStart.addEventListener("click", startHeroVideo);
}

if (menuBtn && mobileMenu) {
  menuBtn.setAttribute("aria-expanded", "false");

  menuBtn.addEventListener("click", () => {
    const open = mobileMenu.classList.toggle("open");

    menuBtn.setAttribute("aria-expanded", String(open));
    mobileMenu.setAttribute("aria-hidden", String(!open));
  });

  mobileMenu.querySelectorAll("a").forEach(link => {
    link.addEventListener("click", () => {
      mobileMenu.classList.remove("open");
      menuBtn.setAttribute("aria-expanded", "false");
      mobileMenu.setAttribute("aria-hidden", "true");
    });
  });
}

if (header) {
  let ticking = false;

  const setHeaderState = () => {
    header.classList.toggle("is-scrolled", window.scrollY > 8);
    ticking = false;
  };

  setHeaderState();

  window.addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        requestAnimationFrame(setHeaderState);
        ticking = true;
      }
    },
    { passive: true }
  );
}

if (
  window.matchMedia("(pointer: fine)").matches &&
  !window.matchMedia("(prefers-reduced-motion: reduce)").matches
) {
  const glow = document.createElement("div");
  glow.className = "cursor-glow";
  document.body.appendChild(glow);

  let targetX = window.innerWidth / 2;
  let targetY = window.innerHeight / 2;
  let currentX = targetX;
  let currentY = targetY;

  window.addEventListener(
    "pointermove",
    event => {
      targetX = event.clientX;
      targetY = event.clientY;
      glow.classList.add("visible");
    },
    { passive: true }
  );

  window.addEventListener("pointerleave", () => {
    glow.classList.remove("visible");
  });

  const moveGlow = () => {
    currentX += (targetX - currentX) * 0.16;
    currentY += (targetY - currentY) * 0.16;

    glow.style.transform =
      `translate3d(${currentX}px, ${currentY}px, 0) translate(-50%, -50%)`;

    requestAnimationFrame(moveGlow);
  };

  requestAnimationFrame(moveGlow);
}

const revealEls = document.querySelectorAll(".reveal");

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          observer.unobserve(entry.target);
        }
      });
    },
    {
      rootMargin: "0px 0px -8% 0px",
      threshold: 0.08
    }
  );

  revealEls.forEach(el => observer.observe(el));
} else {
  revealEls.forEach(el => el.classList.add("in"));
}

document.querySelectorAll(".counter").forEach(el => {
  const target = Number(el.dataset.target || 0);

  const runCounter = () => {
    let frame = 0;
    const frames = 40;

    const tick = () => {
      frame += 1;
      el.textContent = Math.round(target * frame / frames);

      if (frame < frames) {
        requestAnimationFrame(tick);
      }
    };

    tick();
  };

  if ("IntersectionObserver" in window) {
    const counterObserver = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting) {
          runCounter();
          counterObserver.unobserve(el);
        }
      },
      { threshold: 0.5 }
    );

    counterObserver.observe(el);
  } else {
    runCounter();
  }
});

document.querySelectorAll(".faq-q").forEach(btn => {
  btn.addEventListener("click", () => {
    btn.closest(".faq-item")?.classList.toggle("open");
  });
});

document.querySelectorAll("[data-drag-scroll]").forEach(rail => {
  let down = false;
  let startX = 0;
  let scrollLeft = 0;

  rail.addEventListener("mousedown", event => {
    down = true;
    startX = event.pageX - rail.offsetLeft;
    scrollLeft = rail.scrollLeft;
    rail.style.cursor = "grabbing";
  });

  ["mouseleave", "mouseup"].forEach(type => {
    rail.addEventListener(type, () => {
      down = false;
      rail.style.cursor = "grab";
    });
  });

  rail.addEventListener("mousemove", event => {
    if (!down) {
      return;
    }

    event.preventDefault();

    const x = event.pageX - rail.offsetLeft;
    rail.scrollLeft = scrollLeft - (x - startX) * 1.3;
  });
});

const form = document.querySelector("#join-form");

if (form) {
  form.addEventListener("submit", event => {
    event.preventDefault();

    const msg = form.querySelector(".form-note");

    if (msg) {
      msg.textContent =
        "Thanks - your demo submission was captured locally. Connect this form to your CRM or form endpoint before launch.";
      msg.style.color = "#c7a35d";
    }

    form.reset();
  });
}

document.addEventListener("keydown", event => {
  const modifier = event.ctrlKey || event.metaKey;

  if (modifier && event.shiftKey && event.key.toLowerCase() === "o") {
    event.preventDefault();
    window.location.href = "login.html";
  }
});

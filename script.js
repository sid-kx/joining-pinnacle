(() => {
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];

  // Mobile navigation
  const menuBtn = $('.menu-btn');
  const mobileMenu = $('.mobile-menu');
  if (menuBtn && mobileMenu) {
    menuBtn.addEventListener('click', () => {
      const open = mobileMenu.classList.toggle('open');
      menuBtn.setAttribute('aria-expanded', String(open));
      mobileMenu.setAttribute('aria-hidden', String(!open));
    });
    $$('a', mobileMenu).forEach(a => a.addEventListener('click', () => {
      mobileMenu.classList.remove('open');
      menuBtn.setAttribute('aria-expanded', 'false');
      mobileMenu.setAttribute('aria-hidden', 'true');
    }));
  }

  // Scroll reveal
  const reveals = $$('.reveal');
  if ('IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    reveals.forEach(el => revealObserver.observe(el));
  } else {
    reveals.forEach(el => el.classList.add('visible'));
  }

  // Count-up stats
  const counters = $$('.counter');
  const animateCounter = el => {
    const target = Number(el.dataset.target || 0);
    if (target === 0) { el.textContent = '0'; return; }
    const duration = 1200;
    const start = performance.now();
    const tick = now => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = String(Math.round(target * eased));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  if ('IntersectionObserver' in window) {
    const counterObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          counterObserver.unobserve(entry.target);
        }
      });
    }, { threshold: .5 });
    counters.forEach(c => counterObserver.observe(c));
  }

  // Drag-to-scroll proof rail
  $$('[data-drag-scroll]').forEach(rail => {
    let down = false, startX = 0, startScroll = 0;
    rail.addEventListener('pointerdown', e => {
      down = true; rail.classList.add('dragging');
      startX = e.clientX; startScroll = rail.scrollLeft;
      rail.setPointerCapture(e.pointerId);
    });
    rail.addEventListener('pointermove', e => {
      if (!down) return;
      rail.scrollLeft = startScroll - (e.clientX - startX) * 1.15;
    });
    const end = () => { down = false; rail.classList.remove('dragging'); };
    rail.addEventListener('pointerup', end);
    rail.addEventListener('pointercancel', end);
  });

  // Review carousel
  const reviews = $$('#reviewSlider .review-card');
  const count = $('#reviewCount');
  let reviewIndex = 0;
  const showReview = index => {
    reviewIndex = (index + reviews.length) % reviews.length;
    reviews.forEach((r, i) => r.classList.toggle('active', i === reviewIndex));
    if (count) count.textContent = `${String(reviewIndex + 1).padStart(2, '0')} / ${String(reviews.length).padStart(2, '0')}`;
  };
  $('#reviewPrev')?.addEventListener('click', () => showReview(reviewIndex - 1));
  $('#reviewNext')?.addEventListener('click', () => showReview(reviewIndex + 1));

  // FAQ accordion
  $$('.faq-item').forEach(item => {
    $('button', item).addEventListener('click', () => {
      const wasOpen = item.classList.contains('open');
      $$('.faq-item.open').forEach(openItem => openItem.classList.remove('open'));
      if (!wasOpen) item.classList.add('open');
    });
  });

  // Demo form behavior. Replace with fetch() to your CRM endpoint before production.
  const form = $('#applicationForm');
  const success = $('#formSuccess');
  form?.addEventListener('submit', e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    try { localStorage.setItem('pinnacle-demo-application', JSON.stringify({ ...data, submittedAt: new Date().toISOString() })); } catch (_) {}
    success?.classList.add('show');
    form.reset();
  });

  // Current year
  const year = $('#year');
  if (year) year.textContent = new Date().getFullYear();
})();

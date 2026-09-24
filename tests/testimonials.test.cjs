const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const tests = [];
const windows = [];
const test = (name, run) => tests.push([name, run]);
const rows = count => Array.from({ length: count }, (_, index) => ({
  id: index + 1,
  youtube_id: String(index + 1).padStart(11, '0'),
  youtube_url: `https://youtube.com/shorts/${String(index + 1).padStart(11, '0')}`,
  created_at: new Date(2026, 0, index + 1).toISOString(),
  title: 'Legacy title must not render', article: 'Legacy body must not render'
}));

function setup(mobile = false, reduced = true) {
  const w = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), {
    runScripts: 'outside-only', url: 'https://join.pinnaclerealty.ca/'
  }).window;
  windows.push(w);
  const changes = [];
  const media = { matches: mobile, addEventListener: (_, callback) => changes.push(callback) };
  w.matchMedia = query => query.includes('reduced-motion') ? { matches: reduced } : media;
  w.console.warn = () => {};
  for (const file of ['youtube.js', 'testimonials.js']) w.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  const galleryRoot = w.document.querySelector('#testimonial-gallery');
  const gallery = new w.TestimonialGallery.Gallery(galleryRoot);
  return { w, gallery, galleryRoot, resize(value) { media.matches = value; changes.forEach(fn => fn()); } };
}

test('desktop shows newest three, then batches of three and hides View More at the end', () => {
  for (const count of [0, 1, 2, 3, 4, 7]) {
    const { gallery, galleryRoot } = setup();
    gallery.setItems(rows(count));
    assert.equal(gallery.grid.children.length, Math.min(3, count));
    assert.equal(gallery.more.hidden, count <= 3);
    if (count) assert.equal(gallery.grid.firstElementChild.dataset.videoId, rows(count)[count - 1].youtube_id);
    for (let visible = 3; visible < count; visible += 3) {
      gallery.more.click();
      assert.equal(gallery.grid.children.length, Math.min(visible + 3, count));
      assert.equal(gallery.more.hidden, visible + 3 >= count);
    }
    assert.equal(galleryRoot.querySelectorAll('iframe,a').length, 0);
    assert.doesNotMatch(galleryRoot.textContent, /Legacy|Read|Load More/);
  }
});

test('legacy rows fall back to valid URLs and invalid rows are skipped without rendering old fields', () => {
  const { gallery } = setup();
  gallery.setItems([
    { id: 1, youtube_id: 'bad', youtube_url: 'https://m.youtube.com/shorts/abcdefghijk/?si=test' },
    { id: 2, youtube_id: null, youtube_url: 'https://evil.com/watch?v=abcdefghijk' },
    { id: 3, youtube_id: 'ABCDEFGHIJK', youtube_url: null },
    { id: 4, article: 'Old article with no video' }
  ]);
  assert.equal(gallery.items.length, 2);
  assert.equal(gallery.items[0].youtube_id, 'abcdefghijk');
  assert.equal(gallery.items[1].youtube_id, 'ABCDEFGHIJK');
  gallery.setItems([]);
  assert(!gallery.state.hidden);
  assert.equal(gallery.state.textContent, 'Testimonials coming soon.');
});

test('only a play click creates a standard inline iframe and replaces the previous active player', () => {
  const { gallery, galleryRoot } = setup();
  gallery.setItems(rows(7));
  assert.equal(galleryRoot.querySelectorAll('iframe').length, 0);
  gallery.grid.children[0].querySelector('button').click();
  const first = galleryRoot.querySelector('iframe');
  assert.match(first.src, /https:\/\/www.youtube.com\/embed\/00000000007\?autoplay=1&playsinline=1/);
  assert(first.allowFullscreen);
  assert(first.title);
  assert.match(first.allow, /encrypted-media/);
  gallery.more.click();
  assert.equal(galleryRoot.querySelector('iframe'), first);
  gallery.grid.children[1].querySelector('button').click();
  assert.equal(galleryRoot.querySelectorAll('iframe').length, 1);
  assert(!first.isConnected);
  assert(gallery.grid.children[0].querySelector('button'));
});

test('mobile uses a bounded three-slot carousel and loops forward/backward with two, three and seven videos', () => {
  for (const count of [2, 3, 7]) {
    const { gallery, w } = setup(true);
    gallery.setItems(rows(count));
    assert(gallery.grid.hidden && !gallery.mobile.hidden && gallery.more.hidden);
    assert.equal(gallery.track.children.length, 3);
    assert.equal(gallery.track.children[0].dataset.videoId, gallery.items[count - 1].youtube_id);
    assert.equal(gallery.track.children[2].dataset.videoId, gallery.items[1].youtube_id);
    for (let i = 1; i <= count * 5; i++) {
      gallery.move(1);
      assert.equal(gallery.index, i % count);
      assert.equal(gallery.track.children.length, 3);
    }
    gallery.move(-1);
    assert.equal(gallery.index, count - 1);
    gallery.track.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.equal(gallery.index, 0);
    gallery.track.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    assert.equal(gallery.index, count - 1);
  }
});

test('one mobile video has no duplicate peeks or unnecessary navigation', () => {
  const { gallery } = setup(true);
  gallery.setItems(rows(1));
  assert.equal(gallery.track.children.length, 1);
  assert(gallery.navigation.hidden);
  assert.equal(gallery.track.tabIndex, -1);
  gallery.move(1); gallery.move(-1);
  assert.equal(gallery.index, 0);
});

test('moving away or crossing the responsive breakpoint removes the playing iframe', () => {
  const { gallery, galleryRoot, resize } = setup(true);
  gallery.setItems(rows(3));
  gallery.track.children[1].querySelector('button').click();
  const first = galleryRoot.querySelector('iframe');
  gallery.move(1);
  assert(!first.isConnected);
  assert.equal(galleryRoot.querySelectorAll('iframe').length, 0);
  gallery.track.children[1].querySelector('button').click();
  resize(false);
  assert.equal(galleryRoot.querySelectorAll('iframe').length, 0);
  assert(!gallery.grid.hidden && gallery.mobile.hidden);
  assert.equal(gallery.grid.children.length, 3);
});

test('swipe threshold rejects minor or vertical gestures; pointer cancellation leaves page scrolling intact', () => {
  const { gallery, w, galleryRoot } = setup(true);
  const { wrap, swipeStep } = w.TestimonialGallery;
  assert.equal(wrap(-1, 3), 2); assert.equal(wrap(3, 3), 0); assert.equal(wrap(2, 0), 0);
  assert.equal(swipeStep(-49, 0), 0);
  assert.equal(swipeStep(-50, 10), 1);
  assert.equal(swipeStep(60, 10), -1);
  assert.equal(swipeStep(-60, 100), 0);
  gallery.setItems(rows(3));
  assert.equal(gallery.track.querySelector('img').draggable, false);
  const pointer = (type, x, y) => {
    const event = new w.Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { isPrimary: true, button: 0, pointerId: 1, clientX: x, clientY: y });
    gallery.track.dispatchEvent(event);
    assert(!event.defaultPrevented);
  };
  pointer('pointerdown', 100, 100); pointer('pointerup', 80, 110);
  assert.equal(gallery.index, 0);
  pointer('pointerdown', 100, 100); pointer('pointercancel', 50, 100); pointer('pointerup', 0, 100);
  assert.equal(gallery.index, 0);
  pointer('pointerdown', 100, 100); pointer('pointerup', 40, 110);
  assert.equal(gallery.index, 1);
  gallery.track.children[1].querySelector('button').click();
  assert.equal(galleryRoot.querySelectorAll('iframe').length, 0, 'swipe release must not also start playback');
});

test('animated navigation rejects duplicate movements and settles at the same wraparound index', () => {
  const { gallery, w } = setup(true, false);
  let finish;
  w.setTimeout = callback => { finish = callback; return 1; };
  gallery.setItems(rows(3));
  gallery.move(-1); gallery.move(-1);
  assert(gallery.moving);
  assert(gallery.track.classList.contains('moving-previous'));
  finish();
  assert.equal(gallery.index, 2);
  assert(!gallery.moving);
  assert.equal(gallery.track.children.length, 3);
});

test('public fetching requires only video columns and database failure has a clean empty state', async () => {
  const { gallery } = setup();
  let selected;
  const db = { from(table) {
    assert.equal(table, 'agent_testimonials');
    return { select(fields) { selected = fields; return { order: async () => ({ data: rows(4), error: null }) }; } };
  } };
  await gallery.load(db);
  assert.equal(selected, 'id,youtube_url,youtube_id,created_at');
  assert.equal(gallery.items.length, 4);
  await gallery.load({ from() { throw new Error('Unavailable'); } });
  assert.equal(gallery.items.length, 0);
  assert(!gallery.state.hidden);
});

(async () => {
  try {
    for (const [name, run] of tests) { await run(); console.log(`PASS ${name}`); }
    console.log(`${tests.length} testimonial gallery groups passed.`);
  } finally { windows.forEach(w => w.close()); }
})().catch(error => { console.error(error); process.exitCode = 1; });

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { build, renderPage } = require('../scripts/build-pages.cjs');
const root = path.resolve(__dirname, '..');
const schedulingUrl = 'https://growwithpinnaclerealty.com/landingpage';
const retiredSchedulingUrl = ['https://calendly.com', 'jag-pinnaclerealty'].join('/');

function verifySchedulingLinks(source) {
  assert(!source.includes(retiredSchedulingUrl));
  const dom = new JSDOM(source);
  const links = [...dom.window.document.querySelectorAll('a')].filter(a =>
    a.textContent.includes('Schedule a Call') || a.getAttribute('href') === schedulingUrl);
  for (const link of links) {
    assert.equal(link.getAttribute('href'), schedulingUrl);
    assert.equal(link.target, '_blank');
    assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
  }
  dom.window.close();
  return links.length;
}

function verifySchedulingTree(directory, sourceTree = false) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || ['.git', 'node_modules'].includes(entry.name) || (sourceTree && entry.name === 'dist')) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) verifySchedulingTree(file, sourceTree);
    else {
      const source = fs.readFileSync(file, 'utf8');
      assert(!source.includes(retiredSchedulingUrl), `Retired scheduling URL in ${file}`);
      if (file.endsWith('.html')) verifySchedulingLinks(source);
    }
  }
}
const windows = [];
function setup(editor = false) {
  const w = new JSDOM('<form><textarea id="body" data-rich-text></textarea></form>', { runScripts: 'outside-only', url: 'https://join.pinnaclerealty.ca/' }).window;
  windows.push(w); w.DOMPurify = require('dompurify')(w);
  w.fetch = async () => ({ ok: true, json: async () => ['/articles/my-title/', '/testimonials/my-title/'] });
  if (editor) w.eval(fs.readFileSync(path.join(root, 'vendor/quill.js'), 'utf8'));
  for (const file of ['rich-text.js', 'content.js']) w.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  if (editor) w.RichText.mount();
  return w;
}
function mockDB(rows = [], supported = true) {
  const calls = []; let conflict = false;
  return {
    rows, calls, raceOnce() { conflict = true; },
    from(table) {
      let fields, action = 'read', payload, key, value;
      return {
        select(f) { fields = f; return this; }, eq(k, v) { key = k; value = v; return this; },
        update(p) { action = 'update'; payload = p; return this; }, insert(p) { action = 'insert'; payload = p; return this; },
        async limit() { calls.push({ action: 'probe', table }); return supported ? { data: [], error: null } : { error: { code: '42703', message: 'column slug does not exist' } }; },
        async maybeSingle() { calls.push({ action, key, value, fields }); return { data: rows.find(r => r[key] === value) || null, error: null }; },
        async single() {
          calls.push({ action, payload, table, fields });
          if (conflict) { conflict = false; rows.push({ id: 'racer', slug: payload.slug }); return { error: { code: '23505', message: 'duplicate key violates table_slug_unique' } }; }
          const existing = rows.find(r => r[key] === value);
          if (action === 'update') Object.assign(existing, payload);
          else rows.push({ id: String(rows.length + 1), ...payload });
          return { data: { id: existing?.id || String(rows.length) }, error: null };
        },
        async order() { calls.push({ fields }); return { data: rows, error: null }; }
      };
    }
  };
}
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('slugify matches the supplied title and normalizes accents, quotes and punctuation', () => {
  const { Content } = setup();
  assert.equal(Content.slugify('How to Get Real Estate Clients in Ontario Without Cold Calling by using "The Attraction Method"'), 'how-to-get-real-estate-clients-in-ontario-without-cold-calling-by-using-the-attraction-method');
  assert.equal(Content.slugify('  Café -- Jag’s "Guide"!  '), 'cafe-jags-guide');
  assert.equal(Content.slugify('!!!'), 'post');
});

test('article table allocate deterministic unique slugs and retain published slugs when titles change', async () => {
  for (const table of ['education_videos']) {
    const { Content } = setup(), db = mockDB();
    for (let n = 0; n < 3; n++) await Content.write(db, table, { title: 'My Title', article: 'Body' });
    assert.deepEqual(db.rows.map(r => r.slug), ['my-title', 'my-title-2', 'my-title-3']);
    await Content.write(db, table, { title: 'Renamed', article: 'Body' }, { ...db.rows[0] });
    assert.equal(db.rows[0].slug, 'my-title');
    db.rows.push({ id: 'old', title: 'Old', slug: null });
    await Content.write(db, table, { title: 'Old', article: 'Body' }, { ...db.rows[3] });
    assert.equal(db.rows[3].slug, 'old');
  }
});

test('slug allocation retries a unique-index race and missing-column compatibility does not send slug', async () => {
  const w = setup(), db = mockDB(); db.raceOnce();
  await w.Content.write(db, 'education_videos', { title: 'My Title' });
  assert.equal(db.rows[1].slug, 'my-title-2');
  const old = mockDB([], false), legacy = setup().Content;
  await legacy.write(old, 'education_videos', { title: 'Before migration' });
  await legacy.select(old, 'education_videos', 'id,title', q => q.order());
  assert(!('slug' in old.rows[0])); assert.equal(old.calls.at(-1).fields, 'id,title');
});

test('normal generated links contain slugs only, with readable pre-build compatibility links', async () => {
  const { Content } = setup(); await Content.loadRoutes();
  assert.equal(Content.url('article', { id: '9', slug: 'my-title' }), '/articles/my-title/');
  assert.equal(Content.url('article', { id: '9' }), '/article.html?id=9');
});

const formatted = '<h2>BIG HEADING</h2><h3>Details</h3><p>Normal <strong>bold <em>and italic</em></strong> <u>underline</u>.</p><ul><li>Bullet one</li><li>Bullet two</li></ul><ol><li>Number one</li><li>Number two</li></ol><blockquote>A quote</blockquote><p style="text-align:center"><span style="font-family:Georgia;font-size:24px">Styled text</span> <a href="https://example.com" target="_blank">Safe link</a></p>';

test('sanitizer retains headings, emphasis, lists, links, spacing, fonts and bounded sizes', () => {
  const w = setup(); const html = w.RichText.toHTML(w.RichText.serialize(formatted));
  const doc = new JSDOM(html).window.document;
  for (const selector of ['h2', 'h3', 'strong em', 'u', 'ul li', 'ol li', 'blockquote', 'a[href="https://example.com"]']) assert(doc.querySelector(selector), selector);
  assert.match(html, /font-size:24px/); assert.match(html, /font-family:Georgia/); assert.match(html, /text-align:center/);
  assert.match(w.RichText.sanitize('<p style="font-size:900px;position:fixed;color:red">Huge</p>'), /font-size:32px/);
});

test('script, event handler, executable URL, iframe, unsafe styles and SVG payloads are removed', () => {
  const w = setup();
  const dirty = '<script>alert(1)</script><p onclick="alert(1)" style="position:fixed;background:url(javascript:evil)">Good</p><iframe src="https://bad.test"></iframe><a href="javascript:alert(1)">Bad</a><a href="jav&#x09;ascript:alert(1)">Bad2</a><svg onload="alert(1)"></svg><img src=x onerror=alert(1)><object data=x></object>';
  const clean = w.RichText.sanitize(dirty);
  assert.doesNotMatch(clean, /<script|onclick|javascript:|<iframe|<svg|<img|onerror|position:|background:|<object/i);
  assert.match(clean, /Good/);
});

test('Quill clipboard and Edit/Save retain supported formatting and sanitize pasted content', async () => {
  const w = setup(true), field = w.document.querySelector('textarea');
  const quill = w.Quill.find(w.document.querySelector('.ql-container'));
  quill.setContents(quill.clipboard.convert({ html: formatted + '<script>alert(1)</script><p onmouseover="alert(1)">Last</p>' }));
  const saved = w.RichText.read(field);
  assert(saved.startsWith(w.RichText.marker)); assert.doesNotMatch(saved, /<script|onmouseover/);
  for (const tag of ['h2', 'h3', 'strong', 'em', 'u', 'ul', 'ol', 'a', 'blockquote']) assert.match(saved, new RegExp(`<${tag}[ >]`));
  w.RichText.set(field, saved);
  assert.equal(w.RichText.read(field), saved);
  const again = quill.getSemanticHTML();
  assert.match(again, /font-size: 24px/); assert.match(again, /font-family: Georgia/);
  w.RichText.set(field, 'First line\nSecond line\n\nNext paragraph');
  assert.equal(quill.getText().includes('First line'), true);
  assert.equal(w.RichText.read(field), 'First line\nSecond line\n\nNext paragraph');
  await new Promise(resolve => setImmediate(resolve));
  quill.scroll.observer.disconnect();
});

test('legacy text remains escaped and excerpts/meta descriptions never include HTML tags', () => {
  const { RichText } = setup();
  assert.equal(RichText.toHTML('First\nSecond\n\nNext <script>bad</script>'), '<p>First<br>Second</p><p>Next &lt;script&gt;bad&lt;/script&gt;</p>');
  assert.equal(RichText.text('<p>Hello <strong>world</strong></p>'), 'Hello world');
  assert.equal(RichText.text(RichText.serialize('<p>Hello <strong>world</strong></p>')), 'Hello world');
});

const post = { id: '9', slug: 'my-title', title: 'My Title', article: '<!--pinnacle-rich-text:v1-->' + formatted, youtube_id: 'abcdefghijk', youtube_url: null, image_urls: ['https://example.com/gallery.jpg', 'https://example.com/second.jpg'], thumbnail_url: 'https://example.com/cover.jpg', created_at: '2026-09-11T00:00:00Z' };

test('article Shorts render standard embeds in static HTML and browser rendering', () => {
  for (const kind of ['article']) {
    for (const url of [
      'https://youtube.com/shorts/abcdefghijk',
      'https://www.youtube.com/shorts/abcdefghijk',
      'https://m.youtube.com/shorts/abcdefghijk',
      'https://www.youtube.com/shorts/abcdefghijk?si=test',
      'https://www.youtube.com/shorts/abcdefghijk/',
      'https://www.youtube.com/shorts/abcdefghijk/?si=test',
      'https://www.youtube.com/watch?v=abcdefghijk',
      'https://youtu.be/abcdefghijk',
      'https://www.youtube.com/embed/abcdefghijk',
      'https://www.youtube-nocookie.com/embed/abcdefghijk'
    ]) {
      for (const id of ['abcdefghijk', null]) {
        const item = { ...post, youtube_id: id, youtube_url: url };
        const dom = new JSDOM(renderPage(kind, item).html, { runScripts: 'outside-only' });
        const w = dom.window;
        windows.push(w);
        const check = () => assert.equal(w.document.querySelector('#article-media iframe').getAttribute('src'), 'https://www.youtube.com/embed/abcdefghijk?rel=0');
        check();
        w.DOMPurify = require('dompurify')(w);
        w.__BUILD_POST__ = item;
        for (const file of ['rich-text.js', 'content.js', 'article.js']) w.eval(fs.readFileSync(path.join(root, file), 'utf8'));
        check();
      }
    }
  }
});

test('static article HTML contains unique metadata and full sanitized content without JS', () => {
  for (const kind of ['article']) {
    const page = renderPage(kind, post), doc = new JSDOM(page.html).window.document;
    assert.equal(doc.querySelector('#article-content').hidden, false);
    assert.equal(doc.querySelector('#article-title').textContent, 'My Title');
    const author = doc.querySelector('.article-author');
    const structured = JSON.parse(doc.querySelector('#article-structured-data').textContent);
    if (kind === 'article') {
      assert.equal(author.textContent, 'Jag Saini \u00b7 Broker of Record');
      assert.equal(doc.querySelector('#article-title').nextElementSibling, author);
      assert.equal(author.nextElementSibling.id, 'article-date');
      assert.deepEqual(structured.author, { '@type': 'Person', name: 'Jag Saini', jobTitle: 'Broker of Record' });
    } else { assert.equal(author, null); assert(!structured.author); }
    assert.equal(doc.querySelector('#article-body h2').textContent, 'BIG HEADING');
    assert.equal(doc.querySelector('#article-body ul li').textContent, 'Bullet one');
    assert.equal(doc.querySelector('link[rel="canonical"]').href, `https://join.pinnaclerealty.ca${page.route}`);
    assert.doesNotMatch(doc.querySelector('meta[name="description"]').content, /[<>]/);
    assert.equal(doc.querySelector('meta[property="og:image"]').content, post.thumbnail_url);
    assert.equal(doc.querySelector('#article-media img').src, post.image_urls[0]);
    assert(!doc.querySelector('#article-media img[src="https://example.com/cover.jpg"]'));
    assert.equal(doc.querySelectorAll('#article-media iframe').length, 1);
    assert.equal(doc.querySelectorAll('#article-media img').length, 1);
  }
});

test('static JSON-LD and hydration data escape closing-script injection', () => {
  const { html } = renderPage('article', { ...post, title: '</script><script>alert(1)</script>', article: '<!--pinnacle-rich-text:v1--><p>Safe</p>' });
  const doc = new JSDOM(html).window.document;
  assert(![...doc.querySelectorAll('script')].some(s => s.textContent === 'alert(1)'));
  assert.equal(JSON.parse(doc.querySelector('#post-snapshot').textContent).title, '</script><script>alert(1)</script>');
});

test('article pages support optional media and carousel looping without using the thumbnail in the body', () => {
  for (const kind of ['article']) {
    for (const [youtube, images] of [[true, 2], [false, 2], [true, 0], [false, 0], [false, 1], [false, 10]]) {
      const item = { ...post, youtube_id: youtube ? post.youtube_id : null, image_urls: Array.from({ length: images }, (_, n) => `https://example.com/${n}.jpg`) };
      const w = new JSDOM(fs.readFileSync(path.join(root, kind + '.html'), 'utf8'), { runScripts: 'outside-only', url: 'https://join.pinnaclerealty.ca/' }).window;
      windows.push(w); w.DOMPurify = require('dompurify')(w); w.__BUILD_POST__ = item;
      for (const file of ['rich-text.js', 'content.js', 'article.js']) w.eval(fs.readFileSync(path.join(root, file), 'utf8'));
      assert.equal(w.document.querySelectorAll('#article-media iframe').length, youtube ? 1 : 0);
      assert.equal(w.document.querySelectorAll('#article-media img').length, images ? 1 : 0);
      const buttons = w.document.querySelectorAll('.testimonial-carousel-controls button');
      assert.equal(buttons.length, images > 1 ? 2 : 0);
      if (images > 1) {
        buttons[0].click(); assert.equal(w.document.querySelector('.testimonial-carousel-counter').textContent, `${images} / ${images}`);
        buttons[1].click(); assert.equal(w.document.querySelector('.testimonial-carousel-counter').textContent, `1 / ${images}`);
        w.renderArticle(item); assert.equal(w.document.querySelector('.testimonial-carousel-counter').textContent, `1 / ${images}`);
        w.document.querySelector('[aria-label="Next photo"]').click();
        assert.equal(w.document.querySelector('.testimonial-carousel-counter').textContent, `2 / ${images}`);
      }
      assert.equal(w.document.querySelector('#article-body h2').textContent, 'BIG HEADING');
    }
  }
});

test('slug page lookup uses slug and old ID links redirect to generated routes', async () => {
  for (const kind of ['article']) {
    for (const legacy of [false, true]) {
      const w = new JSDOM(fs.readFileSync(path.join(root, kind + '.html'), 'utf8'), { runScripts: 'outside-only', url: `https://join.pinnaclerealty.ca/${kind}.html?${legacy ? 'id=9' : 'slug=my-title'}` }).window;
      windows.push(w); w.DOMPurify = require('dompurify')(w); w.db = mockDB([post]);
      w.fetch = async () => ({ ok: true, json: async () => legacy ? [`/${kind === 'article' ? 'articles' : 'testimonials'}/my-title/`] : [] });
      for (const file of ['rich-text.js', 'content.js']) w.eval(fs.readFileSync(path.join(root, file), 'utf8'));
      // JSDOM cannot navigate; replace only the navigation sink to inspect its target.
      const code = fs.readFileSync(path.join(root, 'article.js'), 'utf8').replace('window.location.replace(target)', 'window.redirectTarget = target').replace(/loadArticle\(\);\s*$/, '');
      w.eval(code); await w.loadArticle();
      assert(w.db.calls.some(call => call.key === (legacy ? 'id' : 'slug') && call.value === (legacy ? '9' : 'my-title')));
      if (legacy) assert.equal(w.redirectTarget, `/${kind === 'article' ? 'articles' : 'testimonials'}/my-title/`);
      else assert.equal(w.document.querySelector('#article-title').textContent, post.title);
    }
  }
});

test('static build generates clean directories, route manifest and sitemap without exposing build/admin secrets', async () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'pinnacle-build-test-'));
  try {
    await build({ education_videos: [post], agent_testimonials: [{ ...post, slug: 'why-i-joined' }] }, output);
    verifySchedulingTree(output);
    assert(fs.existsSync(path.join(output, 'articles/my-title/index.html')));
    assert(!fs.existsSync(path.join(output, 'testimonials')));
    assert(!fs.existsSync(path.join(output, 'testimonial.html')));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output, 'post-routes.json'))), ['/articles/my-title/']);
    assert(!fs.existsSync(path.join(output, 'migrations'))); assert(!fs.existsSync(path.join(output, 'node_modules')));
    assert.doesNotMatch(fs.readFileSync(path.join(output, 'sitemap.xml'), 'utf8'), /\/testimonials\//);
    for (const file of ['privacy.html', 'terms.html']) {
      assert(fs.existsSync(path.join(output, file)));
      assert(fs.readFileSync(path.join(output, 'sitemap.xml'), 'utf8').includes(`https://join.pinnaclerealty.ca/${file}`));
    }
    for (const route of ['/articles/my-title/']) {
      const source = fs.readFileSync(path.join(output, route, 'index.html'), 'utf8');
      assert(verifySchedulingLinks(source) >= 3);
      const doc = new JSDOM(source, { url: `https://join.pinnaclerealty.ca${route}` }).window.document;
      for (const file of ['privacy.html', 'terms.html']) assert.equal(doc.querySelector(`.footer-links a[href="/${file}"]`).href, `https://join.pinnaclerealty.ca/${file}`);
    }
  } finally { fs.rmSync(output, { recursive: true, force: true }); }
});

test('all public templates use shared renderer assets and root-safe links', () => {
  for (const template of ['article.html']) {
    const html = fs.readFileSync(path.join(root, template), 'utf8');
    assert.match(html, /<base href="\/">/); assert.match(html, /rich-text.js/); assert.match(html, /vendor\/purify.min.js/);
  }
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(index, /src="testimonials.js"/); assert.doesNotMatch(index, /openTestimonial|testimonial-modal/);
  assert.match(fs.readFileSync(path.join(root, 'blog.html'), 'utf8'), /Content.url\("article", article\)/);
});

test('five public footers share the requested root-safe links; legal pages have static text and shared navigation', () => {
  const expected = ['Home', 'Education', 'Schedule a Call', 'Privacy Policy', 'Terms of Service'];
  for (const file of ['index.html', 'blog.html', 'article.html', 'privacy.html', 'terms.html']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const doc = new JSDOM(source).window.document;
    const links = [...doc.querySelectorAll('.footer-links a')];
    assert.deepEqual(links.map(a => a.textContent.trim()), expected);
    assert.deepEqual(links.map(a => a.getAttribute('href')), ['/index.html', '/blog.html', 'https://growwithpinnaclerealty.com/landingpage', '/privacy.html', '/terms.html']);
    if (['privacy.html', 'terms.html'].includes(file)) {
      assert(doc.querySelector('.site-header .menu-btn')); assert(doc.querySelector('.mobile-menu'));
      assert.equal(doc.querySelector('.article-back').getAttribute('href'), '/index.html');
      assert(doc.querySelectorAll('.legal-body h2').length >= 13);
      assert.match(source, /legal counsel should review/);
      assert(!doc.querySelector('script[src="supabase.js"]'));
    }
  }
});

test('scheduling destinations are replaced throughout source files and public links open safely in new tabs', () => {
  verifySchedulingTree(root, true);
  for (const file of ['index.html', 'blog.html', 'article.html', 'privacy.html', 'terms.html']) {
    assert(verifySchedulingLinks(fs.readFileSync(path.join(root, file), 'utf8')) >= 3);
  }
});

test('dark root styling loads before remote styles; mobile hero uses one portrait Mux player', () => {
  for (const file of ['index.html', 'blog.html', 'article.html', 'privacy.html', 'terms.html', 'admin.html', 'login.html']) {
    const doc = new JSDOM(fs.readFileSync(path.join(root, file), 'utf8')).window.document;
    assert.equal(doc.querySelector('meta[name="theme-color"]').content, '#0b0d0f');
    assert.match(doc.querySelector('style').textContent, /html,body\{background:#0b0d0f\}/);
  }
  const home = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8')).window.document;
  assert.equal(home.querySelectorAll('.hero-vsl mux-player').length, 1);
  assert.equal(home.querySelectorAll('.hero-card,.hero-art,.card-kicker,.hero-card-footer').length, 0);
  const player = home.querySelector('.hero-vsl mux-player');
  assert.equal(player.getAttribute('playback-id'), '501w3LJSd3w01HIHD016qPcf1F778M56y9clgD00SAexvNU');
  assert.equal(player.getAttribute('aria-label'), 'Pinnacle Realty Video');
  assert(player.hasAttribute('playsinline'));
  assert(home.querySelector('script[src="https://cdn.jsdelivr.net/npm/@mux/mux-player"]').defer);
  assert.equal(home.querySelector('.hero-vsl-start').tagName, 'BUTTON');
  assert(!player.hasAttribute('autoplay'));
  assert(home.querySelector('.hero-grid').firstElementChild.querySelector('h1'));
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  assert.match(css, /@media\(max-width:900px\)\{\s*\.hero-grid\{gap:36px\}[\s\S]*?\.hero-grid>\.hero-vsl-wrap\{order:-1/);
  assert.match(css, /\.hero-vsl\{width:min\(100%,360px\);aspect-ratio:9 \/ 16/);
  assert.doesNotMatch(css, /overscroll-behavior/);
});

test('hero first-play overlay waits for success, restores controls once, and retries failed or unloaded playback', async () => {
  const w = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), { runScripts: 'outside-only' }).window;
  windows.push(w);
  w.matchMedia = () => ({ matches: false });
  w.requestAnimationFrame = () => 0;
  w.console.error = () => {};
  w.eval(fs.readFileSync(path.join(root, 'script.js'), 'utf8'));
  const player = w.document.getElementById('hero-vsl-player');
  const button = w.document.querySelector('.hero-vsl-start');
  const frame = player.parentElement;
  const status = w.document.getElementById('hero-vsl-status');
  assert(!button.hidden);
  assert(frame.classList.contains('is-unstarted'));
  button.click();
  assert.match(status.textContent, /still loading/);
  let calls = 0;
  player.play = async () => { calls++; throw Error('Blocked'); };
  button.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert(!button.hidden && !button.disabled);
  assert.match(status.textContent, /Unable to start/);
  assert(frame.classList.contains('is-unstarted'));
  let resolvePlay;
  player.play = () => { calls++; return new Promise(resolve => { resolvePlay = resolve; }); };
  button.click(); button.click();
  assert.equal(calls, 2);
  assert.equal(player.muted, false);
  assert.equal(player.volume, 1);
  assert(!button.hidden);
  player.dispatchEvent(new w.Event('playing'));
  resolvePlay();
  await new Promise(resolve => setImmediate(resolve));
  assert(button.hidden);
  assert(!frame.classList.contains('is-unstarted'));
  assert(!player.hasAttribute('inert'));
  assert.equal(status.textContent, '');
  player.dispatchEvent(new w.Event('pause'));
  player.dispatchEvent(new w.Event('playing'));
  assert(button.hidden);
  button.click();
  assert.equal(calls, 2);
});

(async () => {
  for (const [name, fn] of tests) { await fn(); console.log(`PASS ${name}`); }
  for (const file of ['rich-text.js', 'content.js', 'article.js', 'admin.js']) new vm.Script(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
  console.log(`${tests.length} slug/rich-text/static-page groups passed.`);
  for (const w of windows) w.close();
})().catch(error => { console.error(error); process.exitCode = 1; });

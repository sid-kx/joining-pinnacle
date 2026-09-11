const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { build, renderPage } = require('../scripts/build-pages.cjs');
const root = path.resolve(__dirname, '..');
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

test('both tables allocate deterministic unique slugs and retain published slugs when titles change', async () => {
  for (const table of ['education_videos', 'agent_testimonials']) {
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
  assert.equal(Content.url('testimonial', { id: '9', slug: 'my-title' }), '/testimonials/my-title/');
  assert.equal(Content.url('testimonial', { id: '9', slug: 'new-not-built' }), '/testimonial.html?slug=new-not-built');
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

test('static article and testimonial HTML contains unique metadata and full sanitized content without JS', () => {
  for (const kind of ['article', 'testimonial']) {
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

test('both page types support optional media and carousel looping without using the thumbnail in the body', () => {
  for (const kind of ['article', 'testimonial']) {
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
  for (const kind of ['article', 'testimonial']) {
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
    assert(fs.existsSync(path.join(output, 'articles/my-title/index.html')));
    assert(fs.existsSync(path.join(output, 'testimonials/why-i-joined/index.html')));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output, 'post-routes.json'))), ['/articles/my-title/', '/testimonials/why-i-joined/']);
    assert(!fs.existsSync(path.join(output, 'migrations'))); assert(!fs.existsSync(path.join(output, 'node_modules')));
    assert.match(fs.readFileSync(path.join(output, 'sitemap.xml'), 'utf8'), /testimonials\/why-i-joined/);
  } finally { fs.rmSync(output, { recursive: true, force: true }); }
});

test('all public templates use shared renderer assets and root-safe links', () => {
  for (const template of ['article.html', 'testimonial.html']) {
    const html = fs.readFileSync(path.join(root, template), 'utf8');
    assert.match(html, /<base href="\/">/); assert.match(html, /rich-text.js/); assert.match(html, /vendor\/purify.min.js/);
  }
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(index, /Content.url\("testimonial", item\)/); assert.doesNotMatch(index, /openTestimonial|testimonial-modal/);
  assert.match(fs.readFileSync(path.join(root, 'blog.html'), 'utf8'), /Content.url\("article", article\)/);
});

(async () => {
  for (const [name, fn] of tests) { await fn(); console.log(`PASS ${name}`); }
  for (const file of ['rich-text.js', 'content.js', 'article.js', 'admin.js']) new vm.Script(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
  console.log(`${tests.length} slug/rich-text/static-page groups passed.`);
  for (const w of windows) w.close();
})().catch(error => { console.error(error); process.exitCode = 1; });

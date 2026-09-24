// DOM/Supabase mocks with the real sanitizer. Never contacts a real project.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'admin.js'), 'utf8');
const { JSDOM } = require('jsdom');
const richWindow = new JSDOM('', { runScripts: 'outside-only' }).window;
richWindow.DOMPurify = require('dompurify')(richWindow);
richWindow.eval(fs.readFileSync(path.join(root, 'rich-text.js'), 'utf8'));
const origin = 'https://cms-test.supabase.co';
const imageUrl = (name, bucket = 'video-images') => `${origin}/storage/v1/object/public/${bucket}/${bucket === 'video-images' ? 'videos' : 'testimonials'}/${name}.jpg`;
const file = name => ({ name: `${name}.jpg`, type: 'image/jpeg' });

class Element {
  constructor(tag = 'div') {
    this.tagName = tag; this.children = []; this.events = {}; this.dataset = {};
    this.attributes = {}; this.files = []; this._value = ''; this.textContent = '';
    this.disabled = false; this.hidden = false; this.open = false;
  }
  set value(value) { this._value = value; if (this.type === 'file' && value === '') this.files = []; }
  get value() { return this._value; }
  set innerHTML(value) {
    this._html = value; this.children = [];
    for (const match of value.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
      const button = new Element('button');
      for (const attribute of match[1].matchAll(/([\w-]+)="([^"]*)"/g)) button.setAttribute(attribute[1], attribute[2]);
      button.textContent = match[2].trim(); this.children.push(button);
    }
  }
  get innerHTML() { return this._html || ''; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) {
    this.attributes[key] = value;
    if (key === 'class') this.className = value;
    if (key === 'type') this.type = value;
    if (key.startsWith('data-')) this.dataset[key.slice(5)] = value;
  }
  addEventListener(event, fn) { (this.events[event] ||= []).push(fn); }
  async dispatch(event) { for (const fn of this.events[event] || []) await fn({ preventDefault() {} }); }
  click() { return this.dispatch('click'); }
  focus() {}
  reset() { for (const node of this.fields || []) { node.value = ''; node.files = []; } }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatch('close'); }
  querySelectorAll(selector) {
    const descendants = this.children.flatMap(node => [node, ...node.querySelectorAll('*')]);
    return descendants.filter(node => selector === '*' ||
      (selector.startsWith('.') && (node.className || '').split(' ').includes(selector.slice(1))) ||
      (selector === 'button[type="submit"]' && node.type === 'submit'));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

async function setup(slugsEnabled = false) {
  const nodes = {};
  for (const match of html.matchAll(/<(\w+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const node = nodes[match[3]] = new Element(match[1]);
    node.type = match[2].match(/\btype="([^"]+)"/)?.[1];
  }
  for (const match of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)) {
    const form = nodes[match[1].match(/id="([^"]+)"/)[1]];
    form.fields = [...match[2].matchAll(/\bid="([^"]+)"/g)].map(id => nodes[id[1]]);
    form.children = [...form.fields];
    const submit = new Element('button'); submit.type = 'submit'; form.children.push(submit);
  }
  const rows = {
    education_videos: [{ id: 'article-1', title: 'Article title', article: 'Article text', youtube_url: 'https://www.youtube.com/watch?v=abcdefghijk', youtube_id: 'abcdefghijk', image_urls: [imageUrl('old'), imageUrl('kept')], thumbnail_url: imageUrl('cover') }],
    agent_testimonials: [{ id: 'testimonial-1', title: 'Testimonial title', article: 'Testimonial text', youtube_url: null, youtube_id: null, image_urls: [imageUrl('one', 'testimonial-images')], thumbnail_url: imageUrl('cover', 'testimonial-images') }]
  };
  const calls = [], failures = {}, revoked = [];
  const db = {
    functions: { async invoke(name, options) {
      calls.push({ action: 'rebuild', name, options });
      if (failures.rebuildThrows) throw new Error('Network unavailable');
      return failures.rebuild ? { error: { message: 'Dispatch failed' } } : { data: { accepted: true }, error: null };
    } },
    auth: { async getSession() { return { data: { session: { user: { id: 'admin' } } } }; }, async signOut() {} },
    from(table) {
      const query = { table, action: 'read' };
      const run = () => {
        calls.push({ ...query });
        if (table === 'education_admins') return { data: { user_id: 'admin' }, error: null };
        if (failures[query.action]) return { data: null, error: { message: `${query.action} denied` } };
        if (failures.noId === query.action) return { data: null, error: null };
        if (query.action === 'insert') { const data = { ...query.payload, id: 'new-post' }; rows[table].push(data); return { data: { id: data.id }, error: null }; }
        const row = rows[table].find(item => item[query.key || 'id'] === query.id);
        if (query.action === 'update') { if (!row) return { data: null, error: { message: 'No matching row' } }; Object.assign(row, query.payload); return { data: { id: row.id }, error: null }; }
        if (query.action === 'delete') { rows[table] = rows[table].filter(item => item !== row); return { data: row ? { id: row.id } : null, error: null }; }
        return { data: query.id ? row || null : rows[table], error: null };
      };
      return {
        select(fields) { query.fields = fields; return this; },
        eq(key, value) { query.key = key; query.id = value; return this; },
        insert(payload) { query.action = 'insert'; query.payload = payload; return this; },
        update(payload) { query.action = 'update'; query.payload = payload; return this; },
        delete() { query.action = 'delete'; return this; },
        async single() { return run(); }, async maybeSingle() { return run(); }, async order() { return run(); },
        async limit() { return slugsEnabled ? { data: [], error: null } : { data: null, error: { code: '42703', message: 'column slug does not exist' } }; }
      };
    },
    storage: { from(bucket) { return {
      getPublicUrl(objectPath) { return { data: { publicUrl: `${origin}/storage/v1/object/public/${bucket}/${objectPath}` } }; },
      async upload(objectPath, selected, options) {
        calls.push({ action: 'upload', bucket, path: objectPath, file: selected, options });
        return { error: selected.name === failures.upload ? { message: 'Upload failed' } : null };
      },
      async remove(paths) { calls.push({ action: 'remove', bucket, paths }); return { error: failures.remove ? { message: 'Cleanup denied' } : null }; }
    }; } }
  };
  let uuid = 0;
  class MockURL extends URL {}
  MockURL.createObjectURL = selected => `blob:${selected.name}`;
  MockURL.revokeObjectURL = url => revoked.push(url);
  const context = vm.createContext({
    document: { getElementById: id => nodes[id], createElement: tag => new Element(tag), querySelectorAll: selector => Object.values(nodes).flatMap(node => node.querySelectorAll(selector)) },
    db, SUPABASE_URL: origin, URL: MockURL, crypto: { randomUUID: () => `unique-${++uuid}` },
    window: { location: {}, confirm: () => true }, alert: message => calls.push({ action: 'alert', message }),
    console: { error() {} }, Map, Set, RichText: richWindow.RichText
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'content.js'), 'utf8'), context);
  context.Content = context.window.Content;
  vm.runInContext(fs.readFileSync(path.join(root, "youtube.js"), "utf8"), context);
  context.YouTube = context.window.YouTube;
  vm.runInContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  const run = expression => vm.runInContext(expression, context);
  calls.length = 0;
  return { nodes, rows, calls, failures, context, run, revoked };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const writes = calls => calls.filter(call => ['insert', 'update', 'delete', 'upload', 'remove'].includes(call.action));

test('shared YouTube parser accepts Shorts and legacy URLs with strict hosts, paths and IDs', async () => {
  const { context } = await setup();
  const valid = [
    'https://youtube.com/shorts/abcdefghijk',
    'https://www.youtube.com/shorts/abcdefghijk',
    'https://m.youtube.com/shorts/abcdefghijk',
    'https://www.youtube.com/shorts/abcdefghijk?si=test',
    'https://www.youtube.com/shorts/abcdefghijk/',
    'https://www.youtube.com/shorts/abcdefghijk/?si=test',
    'https://youtu.be/abcdefghijk',
    'https://www.youtu.be/abcdefghijk/?si=test',
    'https://www.youtube.com/watch?v=abcdefghijk&t=3',
    'https://youtube.com/watch?v=abcdefghijk',
    'https://m.youtube.com/watch?v=abcdefghijk',
    'https://www.youtube.com/embed/abcdefghijk',
    'https://www.youtube.com/embed/abcdefghijk/?start=3',
    'https://youtube-nocookie.com/embed/abcdefghijk',
    'https://www.youtube-nocookie.com/embed/abcdefghijk/?rel=0'
  ];
  for (const url of valid) {
    assert.equal(context.extractYoutubeId(url), 'abcdefghijk', url);
    assert(context.isSupportedVideoYoutubeUrl(url, 'abcdefghijk'), url);
    assert(!context.isSupportedVideoYoutubeUrl(url, 'differentID'), url);
  }
  assert.equal(context.extractYoutubeId('https://youtube.com/shorts/aB0_9-zYx12'), 'aB0_9-zYx12');
  for (const url of [
    '', null, 'not a URL',
    'https://youtube.com/shorts/',
    'https://youtube.com/shorts/abc',
    'https://youtube.com/shorts/abcdefghijkl',
    'https://youtube.com/shorts/abcdefghij!',
    'https://youtube.com/shorts/abcdefghijk/extra',
    'https://youtube.com/shorts/abcdefghijk//',
    'https://example.com/shorts/abcdefghijk',
    'https://youtube.com/random/abcdefghijk',
    'https://youtube.com/random/abcdefghijk?v=abcdefghijk',
    'https://youtube.com.evil.com/shorts/abcdefghijk',
    'https://evil-youtu.be/abcdefghijk',
    'https://youtu.be/abcdefghijk/extra',
    'https://youtube-nocookie.com/shorts/abcdefghijk',
    'https://user:password@youtube.com/shorts/abcdefghijk',
    'ftp://youtube.com/shorts/abcdefghijk'
  ]) {
    assert.equal(context.extractYoutubeId(url), '', String(url));
    assert(!context.isSupportedVideoYoutubeUrl(url, 'abcdefghijk'), String(url));
    assert(!context.isSupportedVideoYoutubeUrl(url, ''), String(url));
  }
});

for (const [kind, table, prefix, formId, youtubeField] of [
  ['article', 'education_videos', 'video', 'video-form', 'youtube-url'],
]) {
  for (const [format, url] of [
    ['Shorts', 'https://www.youtube.com/shorts/abcdefghijk/?si=ABC'],
    ['normal video', 'https://www.youtube.com/watch?v=abcdefghijk&si=ABC']
  ]) {
    test(`${kind} publishes and edits a ${format}, preserving URL and extracted ID`, async () => {
      const h = await setup();
      h.nodes[`${prefix}-title`].value = 'YouTube test';
      h.nodes[`${prefix}-article`].value = 'Body text';
      h.nodes[youtubeField].value = url;
      await h.nodes[formId].dispatch('submit');
      const insert = h.calls.find(c => c.action === 'insert');
      assert.equal(insert.table, table);
      assert.equal(insert.payload.youtube_url, url);
      assert.equal(insert.payload.youtube_id, 'abcdefghijk');
      h.context.openContentEditor(kind, 'new-post');
      const editedUrl = url.replace('abcdefghijk', 'aB0_9-zYx12');
      h.nodes['edit-youtube-url'].value = editedUrl;
      await h.nodes['content-edit-form'].dispatch('submit');
      const update = h.calls.find(c => c.action === 'update');
      assert.equal(update.table, table);
      assert.equal(update.payload.youtube_url, editedUrl);
      assert.equal(update.payload.youtube_id, 'aB0_9-zYx12');
    });
  }
  test(`${kind} rejects malformed Shorts before publishing or editing`, async () => {
    for (const url of ['https://youtube.com/shorts/', 'https://youtube.com/shorts/abc', 'https://youtube.com/shorts/abcdefghijk/extra', 'https://example.com/shorts/abcdefghijk', 'https://youtube.com/random/abcdefghijk']) {
      const h = await setup();
      h.nodes[`${prefix}-title`].value = 'Invalid URL';
      h.nodes[`${prefix}-article`].value = 'Body text';
      h.nodes[youtubeField].value = url;
      await h.nodes[formId].dispatch('submit');
      h.context.openContentEditor(kind, `${kind}-1`);
      h.nodes['edit-youtube-url'].value = url;
      await h.nodes['content-edit-form'].dispatch('submit');
      assert.equal(writes(h.calls).length, 0);
      assert.match(h.nodes['edit-message'].textContent, /Shorts/);
    }
  });
}

for (const [kind, table, prefix, formId, id, messageId] of [
  ['article', 'education_videos', 'video', 'video-form', 'article-1', 'admin-message'],
]) {
  for (const action of ['insert', 'update', 'delete']) {
    test(`${kind} ${action} dispatches only after DB success; dispatch failure never rolls back content`, async () => {
      for (const failure of [null, 'rebuild', 'rebuildThrows', action]) {
        const h = await setup();
        if (failure) h.failures[failure] = true;
        if (action === 'insert') {
          h.nodes[`${prefix}-title`].value = 'Saved title';
          h.nodes[`${prefix}-article`].value = 'Saved body';
          await h.nodes[formId].dispatch('submit');
        } else if (action === 'update') {
          h.context.openContentEditor(kind, id);
          h.nodes['edit-title'].value = 'Saved title';
          await h.nodes['content-edit-form'].dispatch('submit');
        } else await h.context[kind === 'article' ? 'deleteVideo' : 'deleteTestimonial'](id);
        const dispatches = h.calls.filter(c => c.action === 'rebuild');
        if (failure === action) { assert.equal(dispatches.length, 0); continue; }
        assert.equal(dispatches.length, 1); assert.equal(dispatches[0].name, 'rebuild-site');
        assert(h.calls.findIndex(c => c.action === action) < h.calls.findIndex(c => c.action === 'rebuild'));
        const message = h.nodes[messageId].textContent;
        assert.match(message, /successfully/);
        assert.match(message, failure ? /rebuild could not be started/ : /SEO pages are being refreshed/);
        if (action === 'delete') assert(!h.rows[table].some(r => r.id === id));
        else assert(h.rows[table].some(r => r.title === 'Saved title'));
        assert(!h.calls.some(c => c.action === 'remove' && action !== 'delete'));
      }
    });
  }
}

test('image-only edits and saved-with-cleanup-warning still request rebuilds', async () => {
  for (const [kind, id, messageId] of [['article', 'article-1', 'admin-message']]) {
    const h = await setup(); h.context.openContentEditor(kind, id);
    await h.nodes['edit-remove-thumbnail'].click(); h.failures.remove = true;
    await h.nodes['content-edit-form'].dispatch('submit');
    assert.equal(h.calls.filter(c => c.action === 'rebuild').length, 1);
    assert.match(h.nodes[messageId].textContent, /cleanup/i);
    assert.match(h.nodes[messageId].textContent, /SEO pages are being refreshed/);
  }
});

test('delayed rebuild feedback does not overwrite newer CMS feedback', async () => {
  const h = await setup(); let complete;
  h.context.db.functions.invoke = () => new Promise(resolve => { complete = resolve; });
  h.nodes['admin-message'].textContent = 'Article saved.';
  const request = h.context.requestSiteRebuild(h.nodes['admin-message']);
  h.nodes['admin-message'].textContent = 'Publishing another article...';
  complete({ data: { accepted: true } }); await request;
  assert.equal(h.nodes['admin-message'].textContent, 'Publishing another article...');
});

for (const [kind, table, prefix, formId] of [
  ['article', 'education_videos', 'video', 'video-form'],
]) {
  test(`${kind} publishing/editing combines sanitized rich text, stable slugs and separate media`, async () => {
    const h = await setup(true);
    const rich = richWindow.RichText.serialize('<h2>Heading</h2><p><strong>Bold</strong> and <em>italic</em>.</p><ul><li>Point</li></ul><script>alert(1)</script>');
    h.nodes[`${prefix}-title`].value = 'A Clearer Future';
    h.nodes[`${prefix}-article`].value = rich;
    h.nodes[`${prefix}-images`].files = [file('gallery')];
    h.nodes[`${prefix}-thumbnail`].files = [file('cover-new')];
    await h.nodes[formId].dispatch('submit');
    const row = h.rows[table].find(item => item.id === 'new-post');
    assert.equal(row.slug, 'a-clearer-future'); assert.equal(row.article, rich);
    assert.equal(row.image_urls.length, 1); assert(row.thumbnail_url);
    assert(!row.image_urls.includes(row.thumbnail_url));
    h.context.openContentEditor(kind, 'new-post');
    h.nodes['edit-title'].value = 'A Different Title';
    await h.nodes['content-edit-form'].dispatch('submit');
    assert.equal(row.slug, 'a-clearer-future'); assert.equal(row.article, rich);
    assert.equal(row.title, 'A Different Title');
    assert(!h.calls.some(call => call.action === 'remove'));
  });
}

test('Single optional thumbnail inputs and published Edit/Delete actions', async () => {
  const h = await setup();
  for (const id of ['video-thumbnail', 'edit-thumbnail']) {
    const tag = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))[0];
    assert.match(tag, /accept="image\/\*"/); assert.doesNotMatch(tag, /multiple|required/);
  }
  for (const id of ['admin-video-list', 'admin-testimonial-list']) {
    assert.match(h.nodes[id].innerHTML, />Edit<\/button>/); assert.match(h.nodes[id].innerHTML, /Delete/);
  }
});

test('Article editor populates fields; Cancel discards all pending images without writes', async () => {
  const h = await setup();
  for (const [kind, id] of [['article', 'article-1']]) {
    h.context.openContentEditor(kind, id);
    assert(h.nodes['edit-title'].value); assert(h.nodes['edit-article'].value);
    assert(h.nodes['edit-existing-images'].children.length);
    const original = JSON.stringify(h.rows);
    h.run('contentEditState.retainedImages.splice(0, 1)');
    h.nodes['edit-title'].value = 'Unsaved';
    h.nodes['edit-thumbnail'].files = [file('replacement')]; await h.nodes['edit-thumbnail'].dispatch('change');
    await h.nodes['edit-cancel'].click();
    assert.equal(h.nodes['content-editor'].open, false); assert.equal(JSON.stringify(h.rows), original);
    assert.equal(writes(h.calls).length, 0);
  }
  assert(h.revoked.length);
});

test('Existing/new photo removal, thumbnail keep/replace/remove, and max 10 validation', async () => {
  const h = await setup(); h.context.openContentEditor('article', 'article-1');
  const retainedBefore = h.run('contentEditState.retainedImages.length');
  await h.nodes['edit-existing-images'].children[0].children[1].click();
  assert.equal(h.run('contentEditState.retainedImages.length'), retainedBefore - 1);
  h.nodes['edit-thumbnail'].files = [file('replacement')]; await h.nodes['edit-thumbnail'].dispatch('change');
  assert.equal(h.run('contentEditState.thumbnailMode'), 'replace');
  await h.nodes['edit-remove-thumbnail'].click(); assert.equal(h.run('contentEditState.thumbnailMode'), 'remove');
  assert.equal(h.nodes['edit-thumbnail-preview'].children.length, 0);
  await h.nodes['edit-keep-thumbnail'].click(); assert.equal(h.nodes['edit-thumbnail-preview'].children[0].children[0].src, imageUrl('cover'));
  h.nodes['edit-images'].files = Array.from({ length: 10 }, (_, i) => file(`new-${i}`));
  await h.nodes['edit-images'].dispatch('change');
  await h.nodes['content-edit-form'].dispatch('submit');
  assert.match(h.nodes['edit-message'].textContent, /1 existing \+ 10 new = 11/);
  assert.equal(writes(h.calls).length, 0);
  await h.nodes['edit-new-images'].children[0].children[1].click();
  assert.equal(h.run('contentEditState.newImages.length'), 9);
  assert.equal(h.context.validateContentImages(Array(4).fill(file('new')), [], 7).includes('11'), true);
  assert(h.context.validateContentImages([], [file('one'), file('two')]));
});

test('Article insert saves separate thumbnail and ordered carousel images', async () => {
  const h = await setup(); h.nodes['video-title'].value = 'New article'; h.nodes['video-article'].value = 'Text';
  h.nodes['video-images'].files = [file('one'), file('two')]; h.nodes['video-thumbnail'].files = [file('cover')];
  await h.nodes['video-form'].dispatch('submit');
  const insert = h.calls.find(call => call.action === 'insert');
  assert.equal(insert.payload.image_urls.length, 2); assert(insert.payload.thumbnail_url);
  assert(!insert.payload.image_urls.includes(insert.payload.thumbnail_url));
  assert.deepEqual(h.calls.filter(c => c.action === 'upload').map(c => c.file.name), ['one.jpg', 'two.jpg', 'cover.jpg']);
  assert.match(h.nodes['admin-message'].textContent, /published successfully/);
});

test('Article update uploads first, saves second, cleans obsolete files last', async () => {
  const h = await setup(); h.context.openContentEditor('article', 'article-1');
  await h.nodes['edit-existing-images'].children[0].children[1].click();
  h.nodes['edit-thumbnail'].files = [file('replacement')]; await h.nodes['edit-thumbnail'].dispatch('change');
  h.nodes['edit-images'].files = [file('new')]; await h.nodes['edit-images'].dispatch('change');
  h.nodes['edit-title'].value = 'Updated';
  await h.nodes['content-edit-form'].dispatch('submit');
  assert.deepEqual(writes(h.calls).map(call => call.action), ['upload', 'upload', 'update', 'remove']);
  assert.equal(h.rows.education_videos[0].title, 'Updated');
  assert.deepEqual([...h.calls.find(call => call.action === 'remove').paths].sort(), ['videos/cover.jpg', 'videos/old.jpg']);
  assert.equal(h.nodes['content-editor'].open, false);
});

test('Failed update rolls back only new files, keeps old row and unsaved text', async () => {
  const h = await setup(); const before = JSON.stringify(h.rows); h.failures.update = true;
  h.context.openContentEditor('article', 'article-1'); h.nodes['edit-title'].value = 'Retain this draft';
  h.nodes['edit-thumbnail'].files = [file('replacement')]; await h.nodes['edit-thumbnail'].dispatch('change');
  await h.nodes['content-edit-form'].dispatch('submit');
  assert.equal(JSON.stringify(h.rows), before); assert.equal(h.nodes['content-editor'].open, true);
  assert.equal(h.nodes['edit-title'].value, 'Retain this draft');
  const removed = h.calls.filter(call => call.action === 'remove').flatMap(call => [...call.paths]);
  assert.equal(removed.length, 1); assert(removed.every(objectPath => objectPath.includes('unique-')));
  assert.match(h.nodes['edit-message'].textContent, /Database update failed/);
});

test('Partial upload and insert failure clean up all newly uploaded article files', async () => {
  for (const failure of ['upload', 'insert']) {
    const h = await setup(); h.failures[failure] = failure === 'upload' ? 'two.jpg' : true;
    h.nodes['video-title'].value = 'Draft'; h.nodes['video-images'].files = [file('one'), file('two')];
    h.nodes['video-thumbnail'].files = [file('cover')];
    await h.nodes['video-form'].dispatch('submit');
    assert.match(h.nodes['admin-message'].textContent, /not published/);
    assert.equal(h.nodes['video-title'].value, 'Draft');
    assert.equal(h.calls.filter(c => c.action === 'remove').flatMap(c => [...c.paths]).length, failure === 'upload' ? 1 : 3);
    assert.equal(h.rows.education_videos.length, 1);
  }
});

test('Successful update with cleanup failure is reported as saved, not rolled back', async () => {
  const h = await setup(); h.failures.remove = true; h.context.openContentEditor('article', 'article-1');
  await h.nodes['edit-remove-thumbnail'].click(); await h.nodes['content-edit-form'].dispatch('submit');
  assert.equal(h.rows.education_videos[0].thumbnail_url, null);
  assert.match(h.nodes['admin-message'].textContent, /saved.*cleanup failed/);
});

test('Thumbnail upload failure rolls back earlier gallery uploads; double submit is ignored', async () => {
  const h = await setup(); h.failures.upload = 'cover.jpg';
  h.nodes['video-title'].value = 'Draft'; h.nodes['video-images'].files = [file('one')];
  h.nodes['video-thumbnail'].files = [file('cover')];
  await h.nodes['video-form'].dispatch('submit');
  assert(!h.calls.some(call => call.action === 'insert'));
  assert.equal(h.calls.filter(c => c.action === 'remove').flatMap(c => [...c.paths]).length, 1);
  h.failures.upload = null; h.calls.length = 0;
  await Promise.all([h.nodes['video-form'].dispatch('submit'), h.nodes['video-form'].dispatch('submit')]);
  assert.equal(h.calls.filter(call => call.action === 'insert').length, 1);
  h.context.openContentEditor('article', 'article-1'); h.calls.length = 0;
  await Promise.all([h.nodes['content-edit-form'].dispatch('submit'), h.nodes['content-edit-form'].dispatch('submit')]);
  assert.equal(h.calls.filter(call => call.action === 'update').length, 1);
});

test('A thumbnail also retained in the carousel is not deleted', async () => {
  const h = await setup(); h.rows.education_videos[0].thumbnail_url = imageUrl('kept');
  await h.context.loadVideos(); h.calls.length = 0;
  h.context.openContentEditor('article', 'article-1'); await h.nodes['edit-remove-thumbnail'].click();
  await h.nodes['content-edit-form'].dispatch('submit');
  assert.equal(h.calls.filter(call => call.action === 'remove').length, 0);
});

test('Article deletion cleans its bucket, including dedicated thumbnail', async () => {
  const h = await setup();
  await h.context.deleteVideo('article-1');
  assert.deepEqual(writes(h.calls).map(call => call.action), ['remove', 'delete']);
  assert.equal(h.calls.find(call => call.action === 'remove').paths.length, 3);
  for (const unsafe of ['bad', imageUrl('bad').replace(origin, 'https://another.supabase.co'), imageUrl('bad', 'testimonial-images'), `${origin}/storage/v1/object/public/video-images/videos/%2E%2E/other.jpg`]) assert.equal(h.context.getVideoImagePath(unsafe), null);
});

test('Storage deletion failure keeps article row; cover helpers do not generate YouTube images', async () => {
  const h = await setup(); h.failures.remove = true; await h.context.deleteVideo('article-1');
  assert(!h.calls.some(call => call.action === 'delete')); assert.equal(h.rows.education_videos.length, 1);
  assert.equal(h.context.getVideoCover({ thumbnail_url: 'dedicated', image_urls: ['gallery'] }), 'dedicated');
});


test('Testimonial forms have only a required URL; list retains Edit and Delete', async () => {
  const h = await setup();
  const dom = new JSDOM(html);
  for (const id of ['testimonial-form', 'testimonial-edit-form']) {
    const fields = [...dom.window.document.getElementById(id).querySelectorAll('input,textarea')];
    assert.equal(fields.length, 1); assert.equal(fields[0].type, 'url'); assert(fields[0].required);
  }
  assert.doesNotMatch(source, /TESTIMONIAL_IMAGE_BUCKET|uploadTestimonialImages|removeTestimonialImages|getTestimonialImagePath|persistTestimonialEdit/);
  assert.match(h.nodes['admin-testimonial-list'].innerHTML, /edit-testimonial/);
  dom.window.close();
});

for (const url of ['https://www.youtube.com/shorts/abcdefghijk/?si=test', 'https://www.youtube.com/watch?v=abcdefghijk']) {
  test('URL-only testimonial publish/edit/delete: ' + url, async () => {
    const h = await setup(true);
    h.nodes['testimonial-youtube-url'].value = url;
    await h.nodes['testimonial-form'].dispatch('submit');
    const inserted = h.calls.find(c => c.action === 'insert');
    assert.deepEqual(Object.keys(inserted.payload).sort(), ['youtube_id','youtube_url']);
    assert.equal(inserted.payload.youtube_url, url);
    assert.equal(inserted.payload.youtube_id, 'abcdefghijk');
    h.context.openTestimonialEditor('new-post');
    h.nodes['testimonial-edit-url'].value = 'https://youtu.be/aB0_9-zYx12';
    await h.nodes['testimonial-edit-form'].dispatch('submit');
    const update = h.calls.find(c => c.action === 'update');
    assert.deepEqual(Object.keys(update.payload).sort(), ['youtube_id','youtube_url']);
    assert.equal(update.payload.youtube_id, 'aB0_9-zYx12');
    await h.context.deleteTestimonial('new-post');
    assert(!h.rows.agent_testimonials.some(row => row.id === 'new-post'));
    assert(!h.calls.some(c => ['rebuild','upload','remove'].includes(c.action)));
    assert(!h.calls.some(c => /slug|image_urls|thumbnail_url/.test(c.fields || '') && c.table === 'agent_testimonials'));
  });
}
test('Testimonials reject missing/invalid URLs before writes; cancel keeps historical fields intact', async () => {
  for (const url of ['', 'https://evil.com/shorts/abcdefghijk', 'https://youtube.com/shorts/abc']) {
    const h = await setup();
    h.nodes['testimonial-youtube-url'].value = url;
    await h.nodes['testimonial-form'].dispatch('submit');
    h.context.openTestimonialEditor('testimonial-1');
    h.nodes['testimonial-edit-url'].value = url;
    await h.nodes['testimonial-edit-form'].dispatch('submit');
    assert.equal(writes(h.calls).length, 0);
    const original = JSON.stringify(h.rows.agent_testimonials);
    await h.nodes['testimonial-edit-cancel'].click();
    assert.equal(h.nodes['testimonial-editor'].open, false);
    assert.equal(JSON.stringify(h.rows.agent_testimonials), original);
  }
});
test('Testimonial failed writes retain drafts and old data; no Storage or rebuild calls', async () => {
  for (const action of ['insert','update','delete']) {
    for (const noId of [false,true]) {
      const h = await setup();
      if (noId) h.failures.noId = action; else h.failures[action] = true;
      const original = JSON.stringify(h.rows.agent_testimonials);
      if (action === 'insert') {
        h.nodes['testimonial-youtube-url'].value = 'https://youtu.be/abcdefghijk';
        await h.nodes['testimonial-form'].dispatch('submit');
        assert.match(h.nodes['testimonial-message'].textContent, /Unable to publish/);
        assert(h.nodes['testimonial-youtube-url'].value);
      } else if (action === 'update') {
        h.context.openTestimonialEditor('testimonial-1');
        h.nodes['testimonial-edit-url'].value = 'https://youtu.be/abcdefghijk';
        await h.nodes['testimonial-edit-form'].dispatch('submit');
        assert.match(h.nodes['testimonial-edit-message'].textContent, /Unable to save/);
        assert(h.nodes['testimonial-editor'].open);
      } else {
        await h.context.deleteTestimonial('testimonial-1');
        assert(h.calls.some(c => c.action === 'alert'));
      }
      assert.equal(JSON.stringify(h.rows.agent_testimonials), original);
      assert(!h.calls.some(c => ['rebuild','upload','remove'].includes(c.action)));
    }
  }
});
test('Testimonial edits do not mutate retained legacy data and double submits are ignored', async () => {
  const h = await setup();
  h.nodes['testimonial-youtube-url'].value = 'https://youtu.be/abcdefghijk';
  await Promise.all([h.nodes['testimonial-form'].dispatch('submit'), h.nodes['testimonial-form'].dispatch('submit')]);
  assert.equal(h.calls.filter(c => c.action === 'insert').length, 1);
  const original = {...h.rows.agent_testimonials[0]};
  h.context.openTestimonialEditor('testimonial-1');
  h.nodes['testimonial-edit-url'].value = 'https://youtu.be/abcdefghijk';
  await Promise.all([h.nodes['testimonial-edit-form'].dispatch('submit'), h.nodes['testimonial-edit-form'].dispatch('submit')]);
  assert.equal(h.calls.filter(c => c.action === 'update').length, 1);
  for (const key of ['title','article','image_urls','thumbnail_url']) assert.deepEqual(h.rows.agent_testimonials[0][key],original[key]);
});

(async () => {
  for (const [name, fn] of tests) { await fn(); console.log(`PASS ${name}`); }
  for (const filename of ['admin.js', 'article.js', 'script.js', 'youtube.js', 'testimonials.js']) new vm.Script(fs.readFileSync(path.join(root, filename), 'utf8'), { filename });
  for (const filename of ['blog.html', 'index.html', 'article.html']) {
    for (const match of fs.readFileSync(path.join(root, filename), 'utf8').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (!/\bsrc=|application\/ld\+json/i.test(match[1])) new vm.Script(match[2], { filename });
    }
  }
  console.log(`${tests.length} CMS test groups passed; JavaScript syntax checks passed.`);
  richWindow.close();
})().catch(error => { console.error(error); process.exitCode = 1; });

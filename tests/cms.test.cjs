// Dependency-free DOM/Supabase mocks. Never contacts a real project.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'admin.js'), 'utf8');
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

async function setup() {
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
    auth: { async getSession() { return { data: { session: { user: { id: 'admin' } } } }; }, async signOut() {} },
    from(table) {
      const query = { table, action: 'read' };
      const run = () => {
        calls.push({ ...query });
        if (table === 'education_admins') return { data: { user_id: 'admin' }, error: null };
        if (failures[query.action]) return { data: null, error: { message: `${query.action} denied` } };
        if (failures.noId === query.action) return { data: null, error: null };
        if (query.action === 'insert') { const data = { ...query.payload, id: 'new-post' }; rows[table].push(data); return { data: { id: data.id }, error: null }; }
        const row = rows[table].find(item => item.id === query.id);
        if (query.action === 'update') { if (!row) return { data: null, error: { message: 'No matching row' } }; Object.assign(row, query.payload); return { data: { id: row.id }, error: null }; }
        if (query.action === 'delete') { rows[table] = rows[table].filter(item => item !== row); return { data: row ? { id: row.id } : null, error: null }; }
        return { data: query.id ? row : rows[table], error: null };
      };
      return {
        select(fields) { query.fields = fields; return this; },
        eq(key, value) { query.id = value; return this; },
        insert(payload) { query.action = 'insert'; query.payload = payload; return this; },
        update(payload) { query.action = 'update'; query.payload = payload; return this; },
        delete() { query.action = 'delete'; return this; },
        async single() { return run(); }, async maybeSingle() { return run(); }, async order() { return run(); }
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
    console: { error() {} }, Map, Set
  });
  vm.runInContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  const run = expression => vm.runInContext(expression, context);
  calls.length = 0;
  return { nodes, rows, calls, failures, context, run, revoked };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const writes = calls => calls.filter(call => ['insert', 'update', 'delete', 'upload', 'remove'].includes(call.action));

test('Single optional thumbnail inputs and published Edit/Delete actions', async () => {
  const h = await setup();
  for (const id of ['video-thumbnail', 'testimonial-thumbnail', 'edit-thumbnail']) {
    const tag = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))[0];
    assert.match(tag, /accept="image\/\*"/); assert.doesNotMatch(tag, /multiple|required/);
  }
  for (const id of ['admin-video-list', 'admin-testimonial-list']) {
    assert.match(h.nodes[id].innerHTML, />Edit<\/button>/); assert.match(h.nodes[id].innerHTML, /Delete/);
  }
});

test('Both editors populate fields; Cancel discards all pending images without writes', async () => {
  const h = await setup();
  for (const [kind, id] of [['article', 'article-1'], ['testimonial', 'testimonial-1']]) {
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

for (const [name, galleryCount, thumbnail, youtube] of [
  ['thumbnail only, no YouTube', 0, true, false],
  ['no thumbnail or gallery', 0, false, false],
  ['gallery and thumbnail with YouTube', 2, true, true],
  ['gallery without thumbnail', 2, false, false],
  ['ten gallery images and separate thumbnail', 10, true, false]
]) {
  test(`Testimonial publishing: ${name}`, async () => {
    const h = await setup();
    h.nodes['testimonial-title'].value = 'New testimonial'; h.nodes['testimonial-article'].value = 'Article text';
    h.nodes['testimonial-youtube-url'].value = youtube ? 'https://www.youtube.com/watch?v=abcdefghijk' : '';
    h.nodes['testimonial-images'].files = Array.from({ length: galleryCount }, (_, i) => file(`gallery-${i}`));
    h.nodes['testimonial-thumbnail'].files = thumbnail ? [file('dedicated')] : [];
    await h.nodes['testimonial-form'].dispatch('submit');
    const insert = h.calls.find(call => call.action === 'insert');
    assert.equal(insert.table, 'agent_testimonials'); assert.equal(insert.fields, 'id');
    assert.equal(insert.payload.image_urls.length, galleryCount);
    assert.equal(Boolean(insert.payload.thumbnail_url), thumbnail);
    assert(!insert.payload.image_urls.includes(insert.payload.thumbnail_url));
    assert.equal(insert.payload.youtube_id, youtube ? 'abcdefghijk' : null);
    assert.equal(insert.payload.youtube_url === null, !youtube);
    const uploads = h.calls.filter(c => c.action === 'upload');
    assert(uploads.every(c => c.bucket === 'testimonial-images' && c.path.startsWith('testimonials/') && c.options.upsert === false && c.options.cacheControl === '31536000'));
    assert.equal(new Set(uploads.map(c => c.path)).size, galleryCount + Number(thumbnail));
    assert.deepEqual(uploads.slice(0, galleryCount).map(c => c.file.name), Array.from({ length: galleryCount }, (_, i) => `gallery-${i}.jpg`));
    assert.match(h.nodes['testimonial-message'].textContent, /published successfully.*Database ID/);
    assert.equal(h.nodes['testimonial-title'].value, '');
  });
}

for (const mode of ['keep', 'replace', 'remove']) {
  test(`Testimonial edit ${mode} thumbnail and title/article`, async () => {
    const h = await setup(); h.context.openContentEditor('testimonial', 'testimonial-1');
    assert.equal(h.nodes['edit-thumbnail-preview'].children[0].children[0].src, imageUrl('cover', 'testimonial-images'));
    h.nodes['edit-title'].value = 'Edited title'; h.nodes['edit-article'].value = 'Edited article';
    if (mode === 'replace') { h.nodes['edit-thumbnail'].files = [file('replacement')]; await h.nodes['edit-thumbnail'].dispatch('change'); }
    if (mode === 'remove') await h.nodes['edit-remove-thumbnail'].click();
    assert.equal(writes(h.calls).length, 0);
    await h.nodes['content-edit-form'].dispatch('submit');
    const row = h.rows.agent_testimonials[0];
    assert.equal(row.title, 'Edited title'); assert.equal(row.article, 'Edited article');
    assert.equal(row.image_urls[0], imageUrl('one', 'testimonial-images'));
    assert.equal(h.nodes['content-editor'].open, false);
    assert.match(h.nodes['testimonial-message'].textContent, /saved successfully/);
    assert.equal(h.calls.find(c => c.action === 'update').fields, 'id');
    if (mode === 'keep') {
      assert.equal(row.thumbnail_url, imageUrl('cover', 'testimonial-images'));
      assert.deepEqual(writes(h.calls).map(c => c.action), ['update']);
    } else {
      assert.equal(mode === 'remove' ? row.thumbnail_url === null : row.thumbnail_url.includes('unique-'), true);
      assert.deepEqual(writes(h.calls).map(c => c.action), mode === 'replace' ? ['upload', 'update', 'remove'] : ['update', 'remove']);
      assert.deepEqual([...h.calls.find(c => c.action === 'remove').paths], ['testimonials/cover.jpg']);
    }
  });
}

test('Testimonial gallery removal/addition saves before obsolete cleanup and enforces combined limit', async () => {
  const h = await setup(); h.context.openContentEditor('testimonial', 'testimonial-1');
  h.nodes['edit-images'].files = Array.from({ length: 10 }, (_, i) => file(`new-${i}`));
  await h.nodes['edit-images'].dispatch('change'); await h.nodes['content-edit-form'].dispatch('submit');
  assert.match(h.nodes['edit-message'].textContent, /1 existing \+ 10 new = 11/); assert.equal(writes(h.calls).length, 0);
  await h.nodes['edit-existing-images'].children[0].children[1].click();
  assert.equal(writes(h.calls).length, 0);
  await h.nodes['content-edit-form'].dispatch('submit');
  assert.equal(h.rows.agent_testimonials[0].image_urls.length, 10);
  assert.deepEqual(writes(h.calls).map(c => c.action), [...Array(10).fill('upload'), 'update', 'remove']);
  assert.deepEqual([...h.calls.find(c => c.action === 'remove').paths], ['testimonials/one.jpg']);
});

for (const stage of ['gallery', 'thumbnail', 'insert']) {
  test(`Testimonial publish ${stage} failure rolls back only this submission`, async () => {
    const h = await setup(); const before = JSON.stringify(h.rows);
    if (stage === 'insert') h.failures.insert = true; else h.failures.upload = stage === 'gallery' ? 'two.jpg' : 'cover.jpg';
    h.nodes['testimonial-title'].value = 'Preserved title'; h.nodes['testimonial-article'].value = 'Preserved text';
    h.nodes['testimonial-images'].files = [file('one'), file('two')]; h.nodes['testimonial-thumbnail'].files = [file('cover')];
    await h.nodes['testimonial-form'].dispatch('submit');
    assert.equal(JSON.stringify(h.rows), before);
    assert.equal(h.nodes['testimonial-article'].value, 'Preserved text');
    assert.match(h.nodes['testimonial-message'].textContent, /not published/);
    const paths = h.calls.filter(c => c.action === 'remove').flatMap(c => [...c.paths]);
    assert.equal(paths.length, stage === 'gallery' ? 1 : stage === 'thumbnail' ? 2 : 3);
    assert(paths.every(p => p.startsWith('testimonials/unique-')));
    assert(h.calls.filter(c => c.action === 'remove').every(c => c.bucket === 'testimonial-images'));
  });
}

for (const stage of ['gallery', 'thumbnail', 'update']) {
  test(`Testimonial edit ${stage} failure preserves old row/files and draft`, async () => {
    const h = await setup(); const before = JSON.stringify(h.rows);
    if (stage === 'update') h.failures.update = true; else h.failures.upload = stage === 'gallery' ? 'two.jpg' : 'replacement.jpg';
    h.context.openContentEditor('testimonial', 'testimonial-1');
    h.nodes['edit-article'].value = 'Preserved edit';
    await h.nodes['edit-existing-images'].children[0].children[1].click();
    h.nodes['edit-images'].files = [file('one'), file('two')]; await h.nodes['edit-images'].dispatch('change');
    h.nodes['edit-thumbnail'].files = [file('replacement')]; await h.nodes['edit-thumbnail'].dispatch('change');
    await h.nodes['content-edit-form'].dispatch('submit');
    assert.equal(JSON.stringify(h.rows), before); assert.equal(h.nodes['edit-article'].value, 'Preserved edit');
    assert.equal(h.nodes['content-editor'].open, true); assert.match(h.nodes['edit-message'].textContent, /Unable to save/);
    const paths = h.calls.filter(c => c.action === 'remove').flatMap(c => [...c.paths]);
    assert.equal(paths.length, stage === 'gallery' ? 1 : stage === 'thumbnail' ? 2 : 3);
    assert(paths.every(p => p.startsWith('testimonials/unique-')));
  });
}

test('Testimonial cleanup warning does not undo a successful update', async () => {
  const h = await setup(); h.failures.remove = true;
  h.context.openContentEditor('testimonial', 'testimonial-1');
  await h.nodes['edit-remove-thumbnail'].click(); await h.nodes['content-edit-form'].dispatch('submit');
  assert.equal(h.rows.agent_testimonials[0].thumbnail_url, null);
  assert.match(h.nodes['testimonial-message'].textContent, /saved.*cleanup failed/);
  assert.equal(h.nodes['content-editor'].open, false);
});

test('Testimonial shared references survive thumbnail or gallery removal', async () => {
  for (const removal of ['thumbnail', 'gallery']) {
    const h = await setup(); h.rows.agent_testimonials[0].thumbnail_url = imageUrl('one', 'testimonial-images') + '?download=1';
    await h.context.loadTestimonials(); h.calls.length = 0;
    h.context.openContentEditor('testimonial', 'testimonial-1');
    if (removal === 'thumbnail') await h.nodes['edit-remove-thumbnail'].click();
    else await h.nodes['edit-existing-images'].children[0].children[1].click();
    await h.nodes['content-edit-form'].dispatch('submit');
    assert.equal(h.calls.filter(c => c.action === 'remove').length, 0);
  }
});

test('Testimonial validation rejects empty required content, bad YouTube links and excess files before writes', async () => {
  for (const invalid of ['title', 'article', 'youtube', 'images', 'thumbnail', 'mime']) {
    const h = await setup(); h.nodes['testimonial-title'].value = 'Title'; h.nodes['testimonial-article'].value = 'Text';
    if (invalid === 'title' || invalid === 'article') h.nodes[`testimonial-${invalid}`].value = ' ';
    if (invalid === 'youtube') h.nodes['testimonial-youtube-url'].value = 'https://not-youtube.example/watch?v=abcdefghijk';
    if (invalid === 'images') h.nodes['testimonial-images'].files = Array(11).fill(file('too-many'));
    if (invalid === 'thumbnail') h.nodes['testimonial-thumbnail'].files = [file('one'), file('two')];
    if (invalid === 'mime') h.nodes['testimonial-thumbnail'].files = [{ name: 'bad.txt', type: 'text/plain' }];
    await h.nodes['testimonial-form'].dispatch('submit'); assert.equal(writes(h.calls).length, 0, invalid);
  }
  const h = await setup(); h.context.openContentEditor('testimonial', 'testimonial-1'); h.nodes['edit-article'].value = '';
  await h.nodes['content-edit-form'].dispatch('submit'); assert.equal(writes(h.calls).length, 0);
});

test('Testimonial double publishing/saving is ignored and missing returned IDs are errors', async () => {
  const h = await setup(); h.nodes['testimonial-title'].value = 'Title'; h.nodes['testimonial-article'].value = 'Text';
  await Promise.all([h.nodes['testimonial-form'].dispatch('submit'), h.nodes['testimonial-form'].dispatch('submit')]);
  assert.equal(h.calls.filter(c => c.action === 'insert').length, 1);
  h.context.openContentEditor('testimonial', 'testimonial-1'); h.calls.length = 0;
  await Promise.all([h.nodes['content-edit-form'].dispatch('submit'), h.nodes['content-edit-form'].dispatch('submit')]);
  assert.equal(h.calls.filter(c => c.action === 'update').length, 1);
  for (const action of ['insert', 'update']) {
    const h = await setup(); h.failures.noId = action;
    if (action === 'insert') {
      h.nodes['testimonial-title'].value = 'Title'; h.nodes['testimonial-article'].value = 'Text';
      h.nodes['testimonial-thumbnail'].files = [file('new')]; await h.nodes['testimonial-form'].dispatch('submit');
      assert.match(h.nodes['testimonial-message'].textContent, /No testimonial ID/);
    } else {
      h.context.openContentEditor('testimonial', 'testimonial-1'); h.nodes['edit-thumbnail'].files = [file('new')];
      await h.nodes['edit-thumbnail'].dispatch('change'); await h.nodes['content-edit-form'].dispatch('submit');
      assert.match(h.nodes['edit-message'].textContent, /No testimonial was updated/);
    }
    assert.equal(h.calls.filter(c => c.action === 'remove').length, 1);
  }
});

test('Testimonial deletion validates and deduplicates gallery/thumbnail URLs', async () => {
  const h = await setup();
  const bad = [null, 'bad', imageUrl('bad'), imageUrl('bad', 'testimonial-images').replace(origin, 'https://foreign.supabase.co'),
    `${origin}/storage/v1/object/public/testimonial-images/testimonials/../testimonials/safe.jpg`,
    `${origin}/storage/v1/object/public/testimonial-images/testimonials/%2e%2e/other.jpg`,
    `${origin}/storage/v1/object/public/testimonial-images/testimonials/%252e%252e/other.jpg`,
    `${origin}/storage/v1/object/public/testimonial-images/testimonials/%00.jpg`,
    `${origin}/storage/v1/object/public/testimonial-images/testimonials/bad\n.jpg`,
    `${origin}/storage/v1/object/public/testimonial-images/other/file.jpg`,
    `${origin}/storage/v1/object/public/testimonial-images/testimonials/%zz.jpg`];
  for (const value of bad) assert.equal(h.context.getTestimonialImagePath(value), null, String(value));
  const good = imageUrl('one', 'testimonial-images');
  h.rows.agent_testimonials[0].image_urls = [good, good + '?download=1', ...bad];
  h.rows.agent_testimonials[0].thumbnail_url = good;
  await h.context.deleteTestimonial('testimonial-1');
  const removal = h.calls.find(c => c.action === 'remove');
  assert.equal(removal.bucket, 'testimonial-images'); assert.deepEqual([...removal.paths], ['testimonials/one.jpg']);
  assert.deepEqual(writes(h.calls).map(c => c.action), ['remove', 'delete']);
});

test('Testimonial deletion handles thumbnail-only and cleanup/database errors clearly', async () => {
  for (const failure of [null, 'remove', 'delete']) {
    const h = await setup(); h.rows.agent_testimonials[0].image_urls = [];
    if (failure) h.failures[failure] = true;
    await h.context.deleteTestimonial('testimonial-1');
    assert.deepEqual([...h.calls.find(c => c.action === 'remove').paths], ['testimonials/cover.jpg']);
    if (failure === 'remove') assert(!h.calls.some(c => c.action === 'delete'));
    if (failure) assert(h.calls.some(c => c.action === 'alert')); else assert.equal(h.rows.agent_testimonials.length, 0);
  }
});

test('Public testimonial query/cover supports thumbnail without YouTube generation; stale guards removed', async () => {
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const query = index.slice(index.indexOf('.from("agent_testimonials")'), index.indexOf('.order(', index.indexOf('.from("agent_testimonials")')));
  assert.match(query, /thumbnail_url/);
  const helper = index.match(/function getTestimonialCover\(item\) \{[\s\S]*?\n    \}/)[0];
  const ctx = vm.createContext({}); vm.runInContext(helper, ctx);
  assert.equal(ctx.getTestimonialCover({ thumbnail_url: 'dedicated', image_urls: ['gallery'] }), 'dedicated');
  assert.equal(ctx.getTestimonialCover({ image_urls: ['gallery'] }), 'gallery');
  assert.equal(ctx.getTestimonialCover({ youtube_id: 'abcdefghijk' }), '');
  assert.doesNotMatch(source + html, /TESTIMONIAL_EDIT_NOTICE|backend update|Nothing will be saved|upcoming backend/i);
});

test('Deletion cleans each bucket correctly, including dedicated article thumbnail', async () => {
  const h = await setup();
  await h.context.deleteVideo('article-1');
  assert.deepEqual(writes(h.calls).map(call => call.action), ['remove', 'delete']);
  assert.equal(h.calls.find(call => call.action === 'remove').paths.length, 3);
  h.calls.length = 0; await h.context.deleteTestimonial('testimonial-1');
  assert.deepEqual(writes(h.calls).map(call => call.action), ['remove', 'delete']);
  assert.equal(h.calls.find(call => call.action === 'remove').bucket, 'testimonial-images');
  for (const unsafe of ['bad', imageUrl('bad').replace(origin, 'https://another.supabase.co'), imageUrl('bad', 'testimonial-images'), `${origin}/storage/v1/object/public/video-images/videos/%2E%2E/other.jpg`]) assert.equal(h.context.getVideoImagePath(unsafe), null);
});

test('Storage deletion failure keeps article row; cover helpers do not generate YouTube images', async () => {
  const h = await setup(); h.failures.remove = true; await h.context.deleteVideo('article-1');
  assert(!h.calls.some(call => call.action === 'delete')); assert.equal(h.rows.education_videos.length, 1);
  assert.equal(h.context.getVideoCover({ thumbnail_url: 'dedicated', image_urls: ['gallery'] }), 'dedicated');
  assert.equal(h.context.getTestimonialCover({ thumbnail_url: 'dedicated', image_urls: ['gallery'] }), 'dedicated');
  assert.equal(h.context.getTestimonialCover({ youtube_id: 'abcdefghijk' }), '');
});

(async () => {
  for (const [name, fn] of tests) { await fn(); console.log(`PASS ${name}`); }
  for (const filename of ['admin.js', 'article.js', 'script.js']) new vm.Script(fs.readFileSync(path.join(root, filename), 'utf8'), { filename });
  for (const filename of ['blog.html', 'index.html', 'article.html']) {
    for (const match of fs.readFileSync(path.join(root, filename), 'utf8').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (!/\bsrc=|application\/ld\+json/i.test(match[1])) new vm.Script(match[2], { filename });
    }
  }
  console.log(`${tests.length} CMS test groups passed; JavaScript syntax checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });

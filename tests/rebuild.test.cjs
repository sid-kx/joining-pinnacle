const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');

(async () => {
  const { createRebuildHandler } = await import(pathToFileURL(path.join(root, 'supabase/functions/rebuild-site/handler.mjs')));
  let passed = 0;
  const run = async (name, fn) => { await fn(); passed++; console.log(`PASS ${name}`); };
  const origin = 'https://join.pinnaclerealty.ca';
  const userId = '00000000-0000-4000-8000-000000000001';
  function setup(options = {}) {
    const calls = [], envReads = [];
    const env = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'test-public-key', GITHUB_PAGES_TOKEN: 'test-only-github-credential', ...options.env };
    const handler = createRebuildHandler({ env: key => { envReads.push(key); return env[key]; }, fetch: async (url, init) => {
      calls.push({ url, ...init });
      if (options.throws) throw new Error(env.GITHUB_PAGES_TOKEN);
      if (url.endsWith('/auth/v1/user')) return Response.json(options.user || { id: userId }, { status: options.authStatus || 200 });
      if (url.includes('/education_admins')) return Response.json(options.admins || [{ user_id: userId }], { status: options.adminStatus || 200 });
      return new Response(null, { status: options.githubStatus || 204 });
    } });
    const invoke = (headers = {}, method = 'POST') => handler(new Request('https://project.supabase.co/functions/v1/rebuild-site', { method, headers: { origin, authorization: 'Bearer test-user-jwt', ...headers }, ...(method === 'POST' ? { body: JSON.stringify({ repo: 'attacker/repo', ref: 'evil', user_id: 'forged' }) } : {}) }));
    return { invoke, calls, envReads };
  }
  await run('authorized admin dispatches only fixed pages.yml/main, using separate credentials and minimal JSON', async () => {
    const h = setup(), response = await h.invoke();
    assert.equal(response.status, 202); assert.deepEqual(await response.json(), { accepted: true });
    assert.equal(h.calls.length, 3);
    assert.equal(h.calls[0].headers.Authorization, 'Bearer test-user-jwt');
    assert.equal(new URL(h.calls[1].url).searchParams.get('user_id'), `eq.${userId}`);
    assert.equal(h.calls[1].headers.Authorization, 'Bearer test-user-jwt');
    assert.equal(h.calls[2].url, 'https://api.github.com/repos/sid-kx/joining-pinnacle/actions/workflows/pages.yml/dispatches');
    assert.equal(h.calls[2].headers.Authorization, 'Bearer test-only-github-credential');
    assert.deepEqual(JSON.parse(h.calls[2].body), { ref: 'main' });
    assert(h.calls.every(c => c.redirect === 'error' && c.signal instanceof AbortSignal));
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal((await setup({ githubStatus: 200 }).invoke()).status, 202);
  });
  await run('missing/invalid/expired/anonymous authentication and non-admin callers cannot dispatch', async () => {
    for (const [options, headers, status] of [
      [{}, { authorization: '' }, 401], [{ authStatus: 401 }, {}, 401],
      [{ user: {} }, {}, 401], [{ user: { id: userId, is_anonymous: true } }, {}, 401],
      [{ admins: [] }, {}, 403], [{ admins: [{ user_id: 'someone-else' }] }, {}, 403],
      [{ adminStatus: 403 }, {}, 503], [{ authStatus: 500 }, {}, 503]
    ]) {
      const h = setup(options); assert.equal((await h.invoke(headers)).status, status);
      assert(!h.calls.some(c => c.url.includes('api.github.com'))); assert(!h.envReads.includes('GITHUB_PAGES_TOKEN'));
    }
  });
  await run('CORS preflight and method checks never dispatch or use credentials', async () => {
    for (const [headers, method, status] of [[{}, 'OPTIONS', 204], [{ origin: 'https://attacker.test' }, 'POST', 403], [{}, 'GET', 405]]) {
      const h = setup(); assert.equal((await h.invoke(headers, method)).status, status); assert.equal(h.calls.length, 0);
    }
  });
  await run('missing secrets, GitHub rejection and network failure fail safely without leaking upstream details', async () => {
    for (const [options, status] of [[{ env: { GITHUB_PAGES_TOKEN: '' } }, 503], [{ env: { SUPABASE_ANON_KEY: '' } }, 503], [{ githubStatus: 403 }, 502], [{ githubStatus: 429 }, 502], [{ throws: true }, 503]]) {
      const h = setup(options), result = await h.invoke(); assert.equal(result.status, status);
      assert.doesNotMatch(await result.text(), /test-only-github-credential|test-user-jwt|test-public-key/);
    }
    const custom = setup({ env: { CMS_SUPABASE_PUBLISHABLE_KEY: 'custom-public-key' } }); await custom.invoke();
    assert.equal(custom.calls[0].headers.apikey, 'custom-public-key');
  });
  await run('workflow retains test/build/dist/deploy stages and static artifacts exclude Edge Function source', async () => {
    const workflow = fs.readFileSync(path.join(root, '.github/workflows/pages.yml'), 'utf8');
    for (const required of ['workflow_dispatch:', 'npm ci', 'npm test', 'npm run build', 'path: dist', 'actions/deploy-pages']) assert(workflow.includes(required));
    const build = fs.readFileSync(path.join(root, 'scripts/build-pages.cjs'), 'utf8');
    assert(!build.match(/const assets = .*['"]supabase['"]/));
    const browser = fs.readFileSync(path.join(root, 'admin.js'), 'utf8');
    assert.doesNotMatch(browser, /GITHUB_PAGES_TOKEN|api\.github\.com|workflow_dispatch/);
    assert.match(fs.readFileSync(path.join(root, 'supabase/config.toml'), 'utf8'), /verify_jwt = true/);
  });
  await run('Edge entrypoint registers its handler without invoking any external service', async () => {
    const previous = globalThis.Deno; let handler;
    globalThis.Deno = { env: { get: () => undefined }, serve: fn => { handler = fn; } };
    try {
      await import(pathToFileURL(path.join(root, 'supabase/functions/rebuild-site/index.ts')));
      assert.equal(typeof handler, 'function');
      assert.equal((await handler(new Request('https://example.test', { method: 'POST' }))).status, 401);
    } finally { if (previous === undefined) delete globalThis.Deno; else globalThis.Deno = previous; }
  });
  console.log(`${passed} Edge Function/security groups passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');

(async () => {
  const { createMetaCapiHandler } = await import(pathToFileURL(path.join(root, 'supabase/functions/meta-capi/handler.mjs')));
  let passed = 0;
  const run = async (name, fn) => { await fn(); passed++; console.log(`PASS ${name}`); };
  const origin = 'https://join.pinnaclerealty.ca';
  const token = 'test-only-meta-token';
  const good = { event_name: 'PageView', event_id: 'pv_abc12345', event_source_url: 'https://join.pinnaclerealty.ca/?utm_source=fb', fbp: 'fb.1.1792080000000.123456789', fbc: 'fb.1.1792080000000.IwAR_abc-123' };
  function setup(options = {}) {
    const calls = [];
    const env = { META_CAPI_ACCESS_TOKEN: token, ...options.env };
    const handler = createMetaCapiHandler({ env: key => env[key], fetch: async (url, init) => {
      calls.push({ url, ...init });
      if (options.throws) throw new Error(token);
      return new Response(options.metaBody || '{"events_received":1}', { status: options.metaStatus || 200 });
    } });
    const invoke = (body = good, headers = {}, method = 'POST') => handler(new Request('https://project.supabase.co/functions/v1/meta-capi', {
      method, headers: { origin, 'user-agent': 'Mozilla/5.0 test', 'x-forwarded-for': '203.0.113.7, 10.0.0.1', 'content-type': 'text/plain', ...headers },
      ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {})
    }));
    return { invoke, calls };
  }

  await run('valid PageView goes to the fixed pixel endpoint with server-side user data and the token in the body', async () => {
    const h = setup(), response = await h.invoke();
    assert.equal(response.status, 202); assert.deepEqual(await response.json(), { accepted: true });
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].url, 'https://graph.facebook.com/v26.0/1010609811725803/events');
    assert.equal(h.calls[0].redirect, 'error'); assert(h.calls[0].signal instanceof AbortSignal);
    const sent = JSON.parse(h.calls[0].body);
    assert.equal(sent.access_token, token); assert.equal(sent.test_event_code, undefined);
    const [event] = sent.data;
    assert.equal(event.event_name, 'PageView'); assert.equal(event.event_id, 'pv_abc12345');
    assert.equal(event.action_source, 'website');
    assert.equal(event.event_source_url, 'https://join.pinnaclerealty.ca/?utm_source=fb');
    assert.deepEqual(event.user_data, { client_ip_address: '203.0.113.7', client_user_agent: 'Mozilla/5.0 test', fbp: good.fbp, fbc: good.fbc });
    assert(Math.abs(event.event_time - Date.now() / 1000) < 5);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  });

  await run('ClickToBook carries only a safe page path; test code and Graph version come only from secrets', async () => {
    const h = setup({ env: { META_TEST_EVENT_CODE: 'TEST70293', META_GRAPH_VERSION: 'v27.0' } });
    assert.equal((await h.invoke({ ...good, event_name: 'ClickToBook', page: '/blog.html' })).status, 202);
    const sent = JSON.parse(h.calls[0].body);
    assert.equal(h.calls[0].url, 'https://graph.facebook.com/v27.0/1010609811725803/events');
    assert.equal(sent.test_event_code, 'TEST70293');
    assert.deepEqual(sent.data[0].custom_data, { page: '/blog.html' });
    const bad = setup({ env: { META_TEST_EVENT_CODE: 'x"; drop', META_GRAPH_VERSION: '../evil' } });
    await bad.invoke({ ...good, event_name: 'ClickToBook', page: 'javascript:alert(1)' });
    const badSent = JSON.parse(bad.calls[0].body);
    assert.equal(bad.calls[0].url, 'https://graph.facebook.com/v26.0/1010609811725803/events');
    assert.equal(badSent.test_event_code, undefined); assert.equal(badSent.data[0].custom_data, undefined);
  });

  await run('foreign origins, wrong methods, other event names, foreign URLs and bad IDs never reach Meta', async () => {
    const h = setup();
    assert.equal((await h.invoke(good, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await h.invoke(good, { origin: '' })).status, 403);
    assert.equal((await h.invoke(undefined, {}, 'GET')).status, 405);
    assert.equal((await h.invoke(undefined, {}, 'OPTIONS')).status, 204);
    assert.equal((await h.invoke({ ...good, event_name: 'Purchase' })).status, 400);
    assert.equal((await h.invoke({ ...good, event_source_url: 'https://evil.example/' })).status, 400);
    assert.equal((await h.invoke({ ...good, event_source_url: 'not a url' })).status, 400);
    assert.equal((await h.invoke({ ...good, event_id: 'short' })).status, 400);
    assert.equal((await h.invoke({ ...good, event_id: 'has spaces in it' })).status, 400);
    assert.equal((await h.invoke('{not json')).status, 400);
    assert.equal((await h.invoke('x'.repeat(5000))).status, 413);
    assert.equal(h.calls.length, 0);
  });

  await run('malformed fbp/fbc cookies and IPs are dropped instead of forwarded', async () => {
    const h = setup();
    await h.invoke({ ...good, fbp: 'fb.1.123.<script>', fbc: 'evil' }, { 'x-forwarded-for': 'not-an-ip' });
    const user = JSON.parse(h.calls[0].body).data[0].user_data;
    assert.deepEqual(user, { client_user_agent: 'Mozilla/5.0 test' });
  });

  await run('missing token, Meta rejection and network failure fail safely without leaking the token or upstream details', async () => {
    const missing = setup({ env: { META_CAPI_ACCESS_TOKEN: '' } });
    const r1 = await missing.invoke(); assert.equal(r1.status, 503); assert.equal(missing.calls.length, 0);
    for (const h of [setup({ metaStatus: 400, metaBody: `{"error":"bad token ${token}"}` }), setup({ throws: true })]) {
      const response = await h.invoke(), text = await response.text();
      assert([502, 503].includes(response.status));
      assert(!text.includes(token)); assert(!text.includes('bad token'));
    }
    assert(!(await r1.text()).includes(token));
  });

  await run('config keeps rebuild-site authenticated and exposes meta-capi publicly; entrypoint only wires the handler', async () => {
    const config = fs.readFileSync(path.join(root, 'supabase/config.toml'), 'utf8');
    assert.match(config, /\[functions\.rebuild-site\]\s*verify_jwt = true/);
    assert.match(config, /\[functions\.meta-capi\][\s\S]*?verify_jwt = false[\s\S]*?entrypoint = "\.\/functions\/meta-capi\/index\.ts"/);
    const entry = fs.readFileSync(path.join(root, 'supabase/functions/meta-capi/index.ts'), 'utf8');
    assert.match(entry, /Deno\.serve\(createMetaCapiHandler\(\{ env: \(name: string\) => Deno\.env\.get\(name\), fetch \}\)\);/);
    assert.doesNotMatch(entry, /access_token|EAA/);
  });

  console.log(`${passed} Meta CAPI groups passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });

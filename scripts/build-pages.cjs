const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const createDOMPurify = require('dompurify');
const root = path.resolve(__dirname, '..');
const fields = 'id,slug,title,article,youtube_url,youtube_id,image_urls,thumbnail_url,created_at';

function renderPage(kind, post) {
  if (kind !== 'article') throw new Error('Only articles have static pages.');
  const filename = 'article.html';
  const dom = new JSDOM(fs.readFileSync(path.join(root, filename), 'utf8'), { runScripts: 'outside-only', url: 'https://join.pinnaclerealty.ca/' });
  const window = dom.window;
  window.DOMPurify = createDOMPurify(window);
  for (const file of ['rich-text.js', 'content.js']) window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  if (!window.Content.validSlug(post.slug)) throw new Error(`Missing/invalid slug for ${kind} ${post.id}. Run the slug migration before building.`);
  window.__BUILD_POST__ = post;
  window.eval(fs.readFileSync(path.join(root, 'article.js'), 'utf8'));
  if (window.document.getElementById('article-content').hidden) {
    window.close();
    throw new Error(`Unable to render ${kind} ${post.id}. Nothing was published.`);
  }
  const snapshot = window.document.createElement('script');
  snapshot.id = 'post-snapshot'; snapshot.type = 'application/json';
  snapshot.textContent = JSON.stringify(post).replace(/</g, '\\u003c');
  window.document.body.insertBefore(snapshot, window.document.body.querySelector('script'));
  const route = window.Content.path(kind, post.slug);
  const html = dom.serialize();
  window.close();
  return { route, html };
}

async function readPosts(table) {
  const source = fs.readFileSync(path.join(root, 'supabase.js'), 'utf8');
  const url = source.match(/SUPABASE_URL\s*=\s*"([^"]+)"/)?.[1];
  const key = source.match(/SUPABASE_PUBLISHABLE_KEY\s*=\s*"([^"]+)"/)?.[1];
  if (!url || !key) throw new Error('Unable to read existing public Supabase configuration.');
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const response = await fetch(`${url}/rest/v1/${table}?select=${fields}&order=id&limit=500&offset=${offset}`, { headers: { apikey: key } });
    if (!response.ok) throw new Error(`Cannot build ${table}: ${await response.text()}. Run migrations/001_content_slugs.sql manually first.`);
    const page = await response.json(); rows.push(...page);
    if (page.length < 500) break;
  }
  return rows;
}

async function build(fixtures, output = path.join(root, 'dist')) {
  const data = fixtures || { education_videos: await readPosts('education_videos') };
  const pages = [];
  for (const [table, kind] of [['education_videos', 'article']]) {
    for (const post of data[table]) pages.push(renderPage(kind, post));
  }
  const routes = pages.map(page => page.route);
  if (new Set(routes).size !== routes.length) throw new Error('Duplicate slugs in build data. Nothing was published.');
  fs.rmSync(output, { recursive: true, force: true }); fs.mkdirSync(output, { recursive: true });
  const assets = ['index.html', 'blog.html', 'privacy.html', 'terms.html', 'article.html', 'article.js', 'youtube.js', 'testimonials.js', 'admin.html', 'admin.js', 'login.html', 'script.js', 'style.css', 'rich-text.js', 'rich-text.css', 'content.js', 'supabase.js', 'CNAME', 'favicon.ico', 'favicon-32x32.png', 'apple-touch-icon.png', 'vendor'];
  assets.push(...fs.readdirSync(root).filter(file => /^google[a-z0-9]+\.html$/.test(file)));
  for (const file of assets) fs.cpSync(path.join(root, file), path.join(output, file), { recursive: true });
  for (const page of pages) {
    const folder = path.join(output, page.route); fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'index.html'), page.html);
  }
  fs.writeFileSync(path.join(output, 'post-routes.json'), JSON.stringify(routes));
  fs.writeFileSync(path.join(output, '.nojekyll'), '');
  fs.writeFileSync(path.join(output, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/', '/blog.html', '/privacy.html', '/terms.html', ...routes].map(route => `<url><loc>https://join.pinnaclerealty.ca${route}</loc></url>`).join('')}</urlset>`);
  return { pages: pages.length, output };
}

module.exports = { build, renderPage };
if (require.main === module) build().then(result => console.log(`Built ${result.pages} static post pages in ${result.output}`)).catch(error => { console.error(error.message); process.exitCode = 1; });

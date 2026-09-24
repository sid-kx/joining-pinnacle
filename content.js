(function (global) {
  "use strict";
  const schema = new Map();
  const origin = "https://join.pinnaclerealty.ca";
  let routes = new Set();
  let routesReady;
  function slugify(title) {
    return String(title || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/ß/g, "ss").replace(/œ/g, "oe").replace(/æ/g, "ae").replace(/ł/g, "l")
      .replace(/["'\u2018\u2019\u201c\u201d]/g, "").replace(/[^a-z0-9\s-]/g, "")
      .trim().replace(/[\s-]+/g, "-").replace(/^-+|-+$/g, "") || "post";
  }
  const validSlug = slug => typeof slug === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
  const missingSlug = error => ["42703", "PGRST204"].includes(error?.code) && /\bslug\b/i.test(error.message || "");
  async function supportsSlugs(db, table) {
    if (!schema.has(table)) {
      const { error } = await db.from(table).select("slug").limit(0);
      if (error && !missingSlug(error)) throw error;
      schema.set(table, !error);
    }
    return schema.get(table);
  }
  async function select(db, table, fields, finish) {
    try {
      const enabled = await supportsSlugs(db, table);
      return await finish(db.from(table).select(fields + (enabled ? ",slug" : "")));
    } catch (error) { return { data: null, error }; }
  }
  async function uniqueSlug(db, table, title, id, start = 1) {
    const base = slugify(title);
    for (let suffix = start; suffix < start + 1000; suffix++) {
      const slug = suffix === 1 ? base : `${base}-${suffix}`;
      const { data, error } = await db.from(table).select("id").eq("slug", slug).maybeSingle();
      if (error) throw error;
      if (!data || String(data.id) === String(id)) return { slug, suffix };
    }
    throw new Error("Unable to allocate a unique slug. Please try a more specific title.");
  }
  async function write(db, table, payload, original) {
    const enabled = await supportsSlugs(db, table);
    let suffix = 1;
    for (let attempt = 0; attempt < 5; attempt++) {
      let slug = original?.slug;
      if (enabled && !slug) ({ slug, suffix } = await uniqueSlug(db, table, payload.title, original?.id, suffix));
      const values = enabled ? { ...payload, slug } : payload;
      const query = original ? db.from(table).update(values).eq("id", original.id) : db.from(table).insert(values);
      const result = await query.select("id").single();
      // The unique index is the final arbiter if two editors race for the same title.
      if (!enabled || original?.slug || result.error?.code !== "23505" || !/slug/i.test(result.error.message || "")) return result;
      suffix++;
    }
    throw new Error("Another post claimed this slug. Please retry saving.");
  }
  function path(kind, slug) {
    if (kind !== "article") throw new Error("Only articles have detail routes.");
    return `/articles/${slug}/`;
  }
  async function loadRoutes() {
    if (!routesReady) routesReady = fetch("/post-routes.json", { cache: "no-cache" })
      .then(response => response.ok ? response.json() : [])
      .then(items => { routes = new Set(Array.isArray(items) ? items : []); }).catch(() => {});
    return routesReady;
  }
  function url(kind, post) {
    if (kind !== "article") throw new Error("Only articles have detail routes.");
    const template = "article.html";
    if (validSlug(post.slug)) {
      const route = path(kind, post.slug);
      return routes.has(route) ? route : `/${template}?slug=${encodeURIComponent(post.slug)}`;
    }
    return `/${template}?id=${encodeURIComponent(post.id)}`;
  }
  global.Content = { slugify, validSlug, supportsSlugs, select, write, uniqueSlug, path, url, loadRoutes, origin };
})(window);

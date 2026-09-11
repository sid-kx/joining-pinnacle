const SITE_ORIGIN = "https://join.pinnaclerealty.ca";
const DISPATCH_URL = "https://api.github.com/repos/sid-kx/joining-pinnacle/actions/workflows/pages.yml/dispatches";

export function createRebuildHandler({ env, fetch: request }) {
  return async function handleRebuild(req) {
    const headers = {
      "Access-Control-Allow-Origin": SITE_ORIGIN,
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
      "Vary": "Origin"
    };
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
    const origin = req.headers.get("origin");
    if (origin && origin !== SITE_ORIGIN) return reply(403, { error: "Origin not allowed." });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (req.method !== "POST") return reply(405, { error: "POST required." });
    const authorization = req.headers.get("authorization") || "";
    if (!/^Bearer [^\s]+$/i.test(authorization)) return reply(401, { error: "Authentication required." });

    const supabaseUrl = env("SUPABASE_URL");
    const publicKey = env("CMS_SUPABASE_PUBLISHABLE_KEY") || env("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !publicKey) return reply(503, { error: "Rebuild authentication is not configured." });
    const authHeaders = { apikey: publicKey, Authorization: authorization };
    const fetchWithTimeout = (url, options) => request(url, { ...options, redirect: "error", signal: AbortSignal.timeout(10000) });

    try {
      // Auth verifies the token server-side; no trust in browser IDs or decoded claims.
      const auth = await fetchWithTimeout(`${supabaseUrl}/auth/v1/user`, { headers: authHeaders });
      if (auth.status === 401 || auth.status === 403) return reply(401, { error: "Invalid or expired session." });
      if (!auth.ok) return reply(503, { error: "Unable to verify authentication." });
      const user = await auth.json();
      if (!user?.id || user.is_anonymous === true) return reply(401, { error: "Authenticated user required." });

      // Use the same user JWT for membership lookup, preserving existing RLS.
      const membership = new URL(`${supabaseUrl}/rest/v1/education_admins`);
      membership.searchParams.set("select", "user_id");
      membership.searchParams.set("user_id", `eq.${user.id}`);
      membership.searchParams.set("limit", "1");
      const admin = await fetchWithTimeout(membership.toString(), { headers: authHeaders });
      if (!admin.ok) return reply(503, { error: "Unable to verify admin authorization." });
      const rows = await admin.json();
      if (!Array.isArray(rows) || !rows.some(row => row.user_id === user.id)) return reply(403, { error: "Admin access required." });

      const githubToken = env("GITHUB_PAGES_TOKEN");
      if (!githubToken) return reply(503, { error: "Site rebuild is not configured." });
      // Repository, workflow and ref cannot be overridden by request data.
      const dispatch = await fetchWithTimeout(DISPATCH_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2026-03-10",
          "Content-Type": "application/json",
          "User-Agent": "pinnacle-cms-rebuild"
        },
        body: JSON.stringify({ ref: "main" })
      });
      if (![200, 204].includes(dispatch.status)) return reply(502, { error: "GitHub did not accept the rebuild request." });
      return reply(202, { accepted: true });
    } catch {
      // Never echo upstream bodies, headers, exception details or environment values.
      return reply(503, { error: "Unable to request a site rebuild. Try again later." });
    }
  };
}

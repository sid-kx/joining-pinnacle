// Server-side Meta Conversions API relay for join.pinnaclerealty.ca.
// The browser pixel sends the same events with the same event_id, so Meta
// de-duplicates them. The access token never leaves the server.
const SITE_ORIGIN = "https://join.pinnaclerealty.ca";
const PIXEL_ID = "1010609811725803";
const DEFAULT_GRAPH_VERSION = "v26.0";
const ALLOWED_EVENTS = new Set(["PageView", "ClickToBook"]);
const EVENT_ID = /^[A-Za-z0-9_-]{8,64}$/;
const FB_COOKIE = /^fb\.\d\.\d{10,13}\.[A-Za-z0-9_.\-]{1,400}$/;
const MAX_BODY = 4096;

function clientIp(req) {
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = (forwarded ? forwarded.split(",")[0] : req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "").trim();
  return /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : undefined;
}

export function buildEvent(input, req, now = Date.now()) {
  if (!input || typeof input !== "object") return null;
  const { event_name, event_id, event_source_url, fbp, fbc, page } = input;
  if (!ALLOWED_EVENTS.has(event_name) || typeof event_id !== "string" || !EVENT_ID.test(event_id)) return null;
  let sourceUrl;
  try { sourceUrl = new URL(event_source_url); } catch { return null; }
  if (sourceUrl.origin !== SITE_ORIGIN) return null;
  const userData = {};
  const ip = clientIp(req), agent = (req.headers.get("user-agent") || "").slice(0, 512);
  if (ip) userData.client_ip_address = ip;
  if (agent) userData.client_user_agent = agent;
  if (typeof fbp === "string" && FB_COOKIE.test(fbp)) userData.fbp = fbp;
  if (typeof fbc === "string" && FB_COOKIE.test(fbc)) userData.fbc = fbc;
  const event = {
    event_name,
    event_time: Math.floor(now / 1000),
    event_id,
    action_source: "website",
    event_source_url: sourceUrl.toString().slice(0, 1024),
    user_data: userData
  };
  if (event_name === "ClickToBook" && typeof page === "string" && /^\/[\w\-./]{0,200}$/.test(page)) event.custom_data = { page };
  return event;
}

export function createMetaCapiHandler({ env, fetch: request }) {
  return async function handleMetaCapi(req) {
    const headers = {
      "Access-Control-Allow-Origin": SITE_ORIGIN,
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
      "Vary": "Origin"
    };
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
    const origin = req.headers.get("origin");
    if (origin !== SITE_ORIGIN) return reply(403, { error: "Origin not allowed." });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (req.method !== "POST") return reply(405, { error: "POST required." });

    let input;
    try {
      const text = await req.text();
      if (text.length > MAX_BODY) return reply(413, { error: "Request too large." });
      input = JSON.parse(text);
    } catch { return reply(400, { error: "Invalid request." }); }
    const event = buildEvent(input, req);
    if (!event) return reply(400, { error: "Invalid event." });

    const token = env("META_CAPI_ACCESS_TOKEN");
    if (!token) return reply(503, { error: "Conversions API is not configured." });
    const version = /^v\d{2,3}\.\d$/.test(env("META_GRAPH_VERSION") || "") ? env("META_GRAPH_VERSION") : DEFAULT_GRAPH_VERSION;
    const payload = { data: [event], access_token: token };
    const testCode = env("META_TEST_EVENT_CODE");
    if (testCode && /^TEST\d{1,10}$/.test(testCode)) payload.test_event_code = testCode;

    try {
      // Pixel ID and endpoint are fixed; request data cannot redirect the call.
      const response = await request(`https://graph.facebook.com/${version}/${PIXEL_ID}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        redirect: "error",
        signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) return reply(502, { error: "Meta did not accept the event." });
      return reply(202, { accepted: true });
    } catch {
      // Never echo upstream bodies, exception details or environment values.
      return reply(503, { error: "Unable to send the event. Try again later." });
    }
  };
}

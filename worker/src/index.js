
const ALLOWED_WEIBO_HOSTS = new Set([
  "weibo.com",
  "www.weibo.com",
  "m.weibo.cn",
  "weibo.cn",
  "www.weibo.cn"
]);

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers
    }
  });
}

function getCorsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowed = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);

  if (!origin) return {};

  if (!allowed.includes(origin)) {
    return null;
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}

export default {
  async fetch(request, env) {
    const cors = getCorsHeaders(request, env);

    if (cors === null) {
      return json({ error: "Origin not allowed." }, 403);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: cors || {}
      });
    }

    const url = new URL(request.url);

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({
        success: true,
        name: "MediaSaver API",
        version: "0.1.0",
        status: "operational",
        platforms: ["weibo"],
        extraction: "not yet implemented"
      }, 200, cors || {});
    }

    if (url.pathname === "/api/parse" && request.method === "POST") {
      let body;

      try {
        body = await request.json();
      } catch {
        return json({ error: "Invalid JSON request." }, 400, cors || {});
      }

      if (!body || typeof body.url !== "string") {
        return json({ error: "Please provide a post URL." }, 400, cors || {});
      }

      let postUrl;

      try {
        postUrl = new URL(body.url.trim());
      } catch {
        return json({ error: "Invalid URL." }, 400, cors || {});
      }

      if (
        postUrl.protocol !== "https:" ||
        !ALLOWED_WEIBO_HOSTS.has(postUrl.hostname.toLowerCase()) ||
        postUrl.username ||
        postUrl.password
      ) {
        return json({
          error: "This is not a supported public Weibo URL."
        }, 400, cors || {});
      }

      return json({
        success: false,
        platform: "Weibo",
        message: "Weibo extraction module is not connected yet."
      }, 501, cors || {});
    }

    return json({ error: "Endpoint not found." }, 404, cors || {});
  }
};

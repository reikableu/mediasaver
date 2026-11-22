
import { parseWeibo } from "./platforms/weibo.js";
import { parseTikTok } from "./platforms/tiktok.js";

import {
  normalizeMediaResponse
} from "./core/media-normalizer.js";

import {
  createDownloadPlan,
  getDownloadSummary
} from "./core/download-manager.js";

const WEIBO_HOSTS = new Set([
  "weibo.com",
  "www.weibo.com",
  "m.weibo.cn",
  "weibo.cn",
  "www.weibo.cn",
  "video.weibo.com"
]);

const TIKTOK_HOSTS = new Set([
  "tiktok.com",
  "www.tiktok.com",
  "m.tiktok.com",
  "vm.tiktok.com",
  "vt.tiktok.com"
]);

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
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
  if (!allowed.includes(origin)) return null;

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}

function detectPlatform(url) {
  const hostname = url.hostname.toLowerCase();

  if (WEIBO_HOSTS.has(hostname)) return "weibo";
  if (TIKTOK_HOSTS.has(hostname)) return "tiktok";

  return null;
}

export default {
  async fetch(request, env) {
    const cors = getCorsHeaders(request, env);

    if (cors === null) {
      return json({
        success: false,
        error: "Origin not allowed."
      }, 403);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: cors || {}
      });
    }

    const url = new URL(request.url);

    if (
      url.pathname === "/api/health" &&
      request.method === "GET"
    ) {
      return json({
        success: true,
        name: "MediaSaver API",
        version: "0.8.0",
        status: "operational",
        platforms: ["weibo", "tiktok"],
        extraction: "connected",
        normalization: "connected",
        downloadManager: "connected",
        sessionStorage: env.MEDIASAVER_SESSIONS
          ? "binding configured"
          : "not configured",
        plannedPlatforms: [
          "douyin",
          "rednote",
          "x"
        ]
      }, 200, cors || {});
    }

    if (
      url.pathname === "/api/parse" &&
      request.method === "POST"
    ) {
      const contentLength = Number(
        request.headers.get("Content-Length") || 0
      );

      if (contentLength > 10000) {
        return json({
          success: false,
          error: "Request body is too large."
        }, 413, cors || {});
      }

      let body;

      try {
        body = await request.json();
      } catch {
        return json({
          success: false,
          error: "Invalid JSON request."
        }, 400, cors || {});
      }

      if (
        !body ||
        typeof body.url !== "string" ||
        !body.url.trim()
      ) {
        return json({
          success: false,
          error: "Please provide a post URL."
        }, 400, cors || {});
      }

      let postUrl;

      try {
        postUrl = new URL(body.url.trim());
      } catch {
        return json({
          success: false,
          error: "Invalid URL."
        }, 400, cors || {});
      }

      if (
        postUrl.protocol !== "https:" ||
        postUrl.username ||
        postUrl.password
      ) {
        return json({
          success: false,
          error: "Please provide a valid HTTPS post URL."
        }, 400, cors || {});
      }

      const platform = detectPlatform(postUrl);

      if (!platform) {
        return json({
          success: false,
          error: "This platform is not supported yet. Currently supported: Weibo and TikTok."
        }, 400, cors || {});
      }

      try {
        let extracted;

        if (platform === "weibo") {
          extracted = await parseWeibo(postUrl.href);
        } else {
          extracted = await parseTikTok(postUrl.href);
        }

        const normalized =
          normalizeMediaResponse(extracted);

        if (
          !normalized.success ||
          !normalized.media.length
        ) {
          return json({
            success: false,
            platform: normalized.platform,
            error: "No supported downloadable media was found."
          }, 422, cors || {});
        }

        const downloadPlan =
          createDownloadPlan(normalized);

        const downloadSummary =
          getDownloadSummary(downloadPlan);

        return json({
          ...normalized,
          downloadPlan,
          downloadSummary
        }, 200, cors || {});

      } catch (error) {
        return json({
          success: false,
          platform:
            platform === "tiktok" ? "TikTok" : "Weibo",
          error: error.message ||
            "Unable to process this post."
        }, 422, cors || {});
      }
    }

    return json({
      success: false,
      error: "Endpoint not found."
    }, 404, cors || {});
  }
};

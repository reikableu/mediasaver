
const ALLOWED_TIKTOK_HOSTS = [
  "tiktok.com",
  "tiktokcdn.com",
  "tiktokv.com",
  "byteoversea.com",
  "ibytedtos.com",
  "muscdn.com"
];

function isTikTokHost(hostname) {
  const host = hostname.toLowerCase();

  return [
    "tiktok.com",
    "tiktok.com"
  ].some(domain =>
    host === domain || host.endsWith("." + domain)
  );
}

function safeMediaUrl(value) {
  if (typeof value !== "string") return null;

  try {
    const url = new URL(value);

    if (url.protocol !== "https:") return null;

    const allowed = ALLOWED_TIKTOK_HOSTS.some(domain =>
      url.hostname === domain ||
      url.hostname.endsWith("." + domain)
    );

    return allowed ? url.href : null;
  } catch {
    return null;
  }
}

function getVideoId(url) {
  const match = url.pathname.match(
    /\/video\/(\d{10,25})/
  );

  return match ? match[1] : null;
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function findVideoData(value, depth = 0) {
  if (!value || depth > 20) return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const result = findVideoData(item, depth + 1);
      if (result) return result;
    }

    return null;
  }

  if (typeof value !== "object") return null;

  const video = value.video;

  if (video && typeof video === "object") {
    const candidates = [
      video.playAddr,
      video.downloadAddr,
      ...(video.bitrateInfo || []).flatMap(item => [
        item.PlayAddr?.UrlList,
        item.playAddr?.urlList
      ].flat().filter(Boolean))
    ].flat();

    const urls = candidates
      .map(safeMediaUrl)
      .filter(Boolean);

    if (urls.length) {
      return {
        video,
        urls
      };
    }
  }

  for (const child of Object.values(value)) {
    const result = findVideoData(child, depth + 1);
    if (result) return result;
  }

  return null;
}

function extractEmbeddedJson(html) {
  const patterns = [
    /<script[^>]+id=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i,
    /<script[^>]+id=["']SIGI_STATE["'][^>]*>([\s\S]*?)<\/script>/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (!match) continue;

    try {
      return JSON.parse(match[1]);
    } catch {
      // Try the next embedded data source.
    }
  }

  return null;
}

async function resolveTikTokUrl(inputUrl) {
  let url = new URL(inputUrl);

  const supportedHosts = [
    "tiktok.com",
    "vm.tiktok.com",
    "vt.tiktok.com"
  ];

  const supported = supportedHosts.some(host =>
    url.hostname === host ||
    url.hostname.endsWith("." + host)
  );

  if (!supported || url.protocol !== "https:") {
    throw new Error("Unsupported TikTok URL.");
  }

  if (
    url.username ||
    url.password
  ) {
    throw new Error("Invalid TikTok URL.");
  }

  if (url.hostname !== "www.tiktok.com") {
    const response = await fetch(url.href, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MediaSaver/1.0)",
        "Accept": "text/html"
      }
    });

    url = new URL(response.url);

    if (!isTikTokHost(url.hostname)) {
      throw new Error("TikTok redirected to an unsupported domain.");
    }
  }

  return url;
}

async function getTikTokOembed(url) {
  const endpoint = new URL(
    "https://www.tiktok.com/oembed"
  );

  endpoint.searchParams.set("url", url.href);

  const response = await fetch(endpoint.href, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; MediaSaver/1.0)"
    }
  });

  if (!response.ok) return null;

  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function getTikTokPage(url) {
  const response = await fetch(url.href, {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml"
    }
  });

  if (!response.ok) {
    throw new Error(
      `TikTok returned HTTP ${response.status}.`
    );
  }

  const finalUrl = new URL(response.url);

  if (!isTikTokHost(finalUrl.hostname)) {
    throw new Error("TikTok redirected to an unsupported domain.");
  }

  return response.text();
}

export async function parseTikTok(postUrl) {
  const url = await resolveTikTokUrl(postUrl);

  const id = getVideoId(url);

  if (!id) {
    throw new Error(
      "Could not identify a TikTok video ID. Please use a direct video link."
    );
  }

  const oembed = await getTikTokOembed(url);

  let html;

  try {
    html = await getTikTokPage(url);
  } catch {
    throw new Error(
      "TikTok's public video page could not be accessed. The post may require verification or be unavailable."
    );
  }

  const embeddedData = extractEmbeddedJson(html);

  const extracted = findVideoData(embeddedData);

  if (!extracted || !extracted.urls.length) {
    throw new Error(
      "TikTok returned no publicly accessible video file. Its page may require verification, or the media URL may not be exposed."
    );
  }

  const thumbnail = safeMediaUrl(
    extracted.video.cover ||
    extracted.video.originCover ||
    oembed?.thumbnail_url
  );

  const description =
    extracted.video.desc ||
    oembed?.title ||
    "";

  const duration = Number(
    extracted.video.duration || 0
  ) || null;

  return {
    success: true,
    platform: "TikTok",
    id,
    author:
      oembed?.author_name ||
      "Unknown",
    text: decodeHtml(description),
    createdAt: null,
    media: extracted.urls.map((videoUrl, index) => ({
      id: `tiktok-${id}-${index + 1}`,
      type: "video",
      url: videoUrl,
      thumbnail,
      filename: `tiktok_${id}.mp4`,
      quality: `Available stream ${index + 1}`,
      duration
    }))
  };
}


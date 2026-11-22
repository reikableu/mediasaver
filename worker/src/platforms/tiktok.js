
const ALLOWED_TIKTOK_HOSTS = [
  "tiktok.com",
  "tiktokcdn.com",
  "tiktokv.com",
  "byteoversea.com",
  "ibytedtos.com",
  "muscdn.com"
];

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

function isAllowedHost(hostname) {
  const host = hostname.toLowerCase();

  return ALLOWED_TIKTOK_HOSTS.some(domain =>
    host === domain || host.endsWith("." + domain)
  );
}

function safeMediaUrl(value) {
  if (typeof value !== "string") return null;

  try {
    const url = new URL(value);

    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !isAllowedHost(url.hostname)
    ) {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

function getUrlValues(value) {
  if (!value) return [];

  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap(getUrlValues);
  }

  if (typeof value === "object") {
    return getUrlValues(
      value.urlList ||
      value.UrlList ||
      value.url_list ||
      value.url ||
      value.uri
    );
  }

  return [];
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

function findVideoObject(value, depth = 0) {
  if (!value || depth > 24) return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const result = findVideoObject(item, depth + 1);
      if (result) return result;
    }

    return null;
  }

  if (typeof value !== "object") return null;

  if (
    value.video &&
    typeof value.video === "object" &&
    (
      value.video.playAddr ||
      value.video.downloadAddr ||
      value.video.bitrateInfo
    )
  ) {
    return {
      video: value.video,
      item: value
    };
  }

  for (const child of Object.values(value)) {
    const result = findVideoObject(child, depth + 1);
    if (result) return result;
  }

  return null;
}

function formatQuality(item) {
  const width = Number(item?.GearNameWidth || item?.width || 0);
  const height = Number(item?.GearNameHeight || item?.height || 0);
  const bitrate = Number(item?.Bitrate || item?.bitrate || 0);

  const dimensions =
    width && height ? `${width}x${height}` : null;

  const rate =
    bitrate ? `${Math.round(bitrate / 1000)} kbps` : null;

  if (dimensions && rate) {
    return `${dimensions} · ${rate}`;
  }

  if (dimensions) return dimensions;
  if (rate) return rate;

  return null;
}

function collectVideoStreams(video) {
  const candidates = [];

  for (const item of video.bitrateInfo || []) {
    const urls = getUrlValues(
      item.PlayAddr ||
      item.playAddr ||
      item.play_addr
    );

    for (const value of urls) {
      const url = safeMediaUrl(value);

      if (url) {
        candidates.push({
          url,
          quality: formatQuality(item),
          bitrate: Number(
            item.Bitrate || item.bitrate || 0
          ),
          width: Number(
            item.GearNameWidth || item.width || 0
          ),
          height: Number(
            item.GearNameHeight || item.height || 0
          )
        });
      }
    }
  }

  if (!candidates.length) {
    for (const value of [
      ...getUrlValues(video.playAddr),
      ...getUrlValues(video.downloadAddr)
    ]) {
      const url = safeMediaUrl(value);

      if (url) {
        candidates.push({
          url,
          quality: null,
          bitrate: 0,
          width: 0,
          height: 0
        });
      }
    }
  }

  return candidates;
}

function streamIdentity(candidate) {
  if (
    candidate.width ||
    candidate.height ||
    candidate.bitrate
  ) {
    return [
      candidate.width,
      candidate.height,
      candidate.bitrate
    ].join(":");
  }

  try {
    const url = new URL(candidate.url);

    // CDN mirrors of the same file are not separate qualities.
    return url.pathname;
  } catch {
    return candidate.url;
  }
}

function deduplicateStreams(candidates) {
  const seen = new Set();
  const result = [];

  for (const candidate of candidates) {
    const identity = streamIdentity(candidate);

    if (seen.has(identity)) continue;

    seen.add(identity);
    result.push(candidate);
  }

  return result;
}

async function checkMediaResponse(mediaUrl, referer) {
  try {
    const response = await fetch(mediaUrl, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        "Referer": referer,
        "Range": "bytes=0-0",
        "Accept": "video/*,*/*"
      },
      redirect: "manual"
    });

    const contentType =
      response.headers.get("Content-Type") || "";

    const contentRange =
      response.headers.get("Content-Range");

    const result = {
      status: response.status,
      contentType,
      contentRange,
      playableResponse:
        (
          response.status === 200 ||
          response.status === 206
        ) &&
        (
          contentType.toLowerCase().startsWith("video/") ||
          contentType.toLowerCase().includes("octet-stream")
        )
    };

    try {
      await response.body?.cancel();
    } catch {
      // Best-effort response cleanup.
    }

    return result;

  } catch {
    return {
      status: null,
      contentType: null,
      contentRange: null,
      playableResponse: false,
      error: "Media response could not be checked."
    };
  }
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

  if (
    !supported ||
    url.protocol !== "https:" ||
    url.username ||
    url.password
  ) {
    throw new Error("Unsupported TikTok URL.");
  }

  if (url.hostname !== "www.tiktok.com") {
    const response = await fetch(url.href, {
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html"
      }
    });

    url = new URL(response.url);

    if (!isAllowedHost(url.hostname)) {
      throw new Error(
        "TikTok redirected to an unsupported domain."
      );
    }

    if (!response.ok) {
      throw new Error(
        `TikTok link resolution returned HTTP ${response.status}.`
      );
    }
  }

  return url;
}

async function getTikTokOembed(url) {
  const endpoint = new URL(
    "https://www.tiktok.com/oembed"
  );

  endpoint.searchParams.set("url", url.href);

  try {
    const response = await fetch(endpoint.href, {
      headers: {
        "Accept": "application/json",
        "User-Agent": USER_AGENT
      }
    });

    if (!response.ok) return null;

    return await response.json();
  } catch {
    return null;
  }
}

async function getTikTokPage(url) {
  const response = await fetch(url.href, {
    redirect: "follow",
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "text/html,application/xhtml+xml"
    }
  });

  const finalUrl = new URL(response.url);

  if (!isAllowedHost(finalUrl.hostname)) {
    throw new Error(
      "TikTok redirected to an unsupported domain."
    );
  }

  if (!response.ok) {
    throw new Error(
      `TikTok returned HTTP ${response.status}.`
    );
  }

  return response.text();
}

export async function parseTikTok(postUrl) {
  const url = await resolveTikTokUrl(postUrl);

  if (!isAllowedHost(url.hostname)) {
    throw new Error("Unsupported TikTok domain.");
  }

  const id = getVideoId(url);

  if (!id) {
    throw new Error(
      "Could not identify a TikTok video ID. Use a direct video link."
    );
  }

  const [oembed, html] = await Promise.all([
    getTikTokOembed(url),
    getTikTokPage(url)
  ]);

  const embeddedData = extractEmbeddedJson(html);
  const found = findVideoObject(embeddedData);

  if (!found) {
    throw new Error(
      "TikTok did not expose usable video information. The post may require verification or be unavailable."
    );
  }

  const video = found.video;
  const item = found.item;

  const streams = deduplicateStreams(
    collectVideoStreams(video)
  );

  if (!streams.length) {
    throw new Error(
      "No publicly accessible video streams were found."
    );
  }

  const thumbnail = safeMediaUrl(
    video.cover ||
    video.originCover ||
    video.dynamicCover ||
    oembed?.thumbnail_url
  );

  const author =
    item.author?.nickname ||
    item.author?.uniqueId ||
    oembed?.author_name ||
    "Unknown";

  const description =
    item.desc ||
    oembed?.title ||
    "";

  const duration =
    Number(video.duration || 0) || null;

  // Check at most two distinct streams to limit requests.
  const checkedStreams = await Promise.all(
    streams.slice(0, 2).map(async stream => ({
      ...stream,
      responseCheck: await checkMediaResponse(
        stream.url,
        url.href
      )
    }))
  );

  const remainingStreams = streams.slice(2);

  const media = [
    ...checkedStreams,
    ...remainingStreams.map(stream => ({
      ...stream,
      responseCheck: null
    }))
  ].map((stream, index) => ({
    id: `tiktok-${id}-${index + 1}`,
    type: "video",
    url: stream.url,
    thumbnail,
    filename: `tiktok_${id}.mp4`,
    quality: stream.quality,
    duration,
    responseCheck: stream.responseCheck
  }));

  return {
    success: true,
    platform: "TikTok",
    id,
    author,
    text: decodeHtml(description),
    createdAt: null,
    media
  };
}

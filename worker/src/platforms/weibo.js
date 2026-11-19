
const ALLOWED_MEDIA_HOSTS = [
  "sinaimg.cn",
  "weibocdn.com",
  "weibo.com",
  "video.weibo.com"
];

function jsonSafeUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;

  try {
    const url = new URL(value);

    if (!["https:", "http:"].includes(url.protocol)) return null;

    const allowed = ALLOWED_MEDIA_HOSTS.some(host =>
      url.hostname === host || url.hostname.endsWith("." + host)
    );

    if (!allowed) return null;

    // Upgrade approved media hosts to HTTPS.
    url.protocol = "https:";
    return url.href;
  } catch {
    return null;
  }
}

function getVideoUrl(mediaInfo) {
  if (!mediaInfo) return null;

  const candidates = [
    mediaInfo.stream_url_hd,
    mediaInfo.mp4_720p_mp4,
    mediaInfo.mp4_hd_url,
    mediaInfo.hd_url,
    mediaInfo.stream_url,
    mediaInfo.mp4_sd_url
  ];

  return candidates.map(jsonSafeUrl).find(Boolean) || null;
}

function extractMedia(post) {
  const media = [];

  for (const pic of post.pics || []) {
    const image = jsonSafeUrl(
      pic.large?.url || pic.original?.url || pic.url
    );

    const livePhoto = jsonSafeUrl(pic.videoSrc);

    if (livePhoto) {
      media.push({
        type: "livephoto",
        image,
        video: livePhoto
      });
    } else if (image) {
      media.push({
        type: "image",
        url: image
      });
    }
  }

  const pageInfo = post.page_info;
  const video = getVideoUrl(pageInfo?.media_info);

  if (video) {
    media.push({
      type: "video",
      url: video,
      thumbnail: jsonSafeUrl(
        pageInfo?.page_pic ||
        pageInfo?.media_info?.big_pic_info?.pic_big?.url
      ),
      duration: pageInfo?.media_info?.duration || null
    });
  }

  return media;
}

async function parseVideoComponent(url) {
  const fid = url.searchParams.get("fid");

  if (!fid || !/^1034:\d{6,20}$/.test(fid)) {
    throw new Error("Invalid Weibo video ID.");
  }

  const apiUrl =
    "https://weibo.com/tv/api/component?page=" +
    encodeURIComponent(`/tv/show/${fid}`);

  const payload = new URLSearchParams({
    data: JSON.stringify({
      Component_Play_Playinfo: {
        oid: fid
      }
    })
  });

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      "Referer": `https://weibo.com/tv/show/${fid}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json, text/plain, */*"
    },
    body: payload.toString(),
    redirect: "error"
  });

  if (!response.ok) {
    throw new Error(
      `Weibo video API returned HTTP ${response.status}.`
    );
  }

  const result = await response.json();

  const playInfo =
    result?.data?.Component_Play_Playinfo;

  if (!playInfo) {
    throw new Error(
      "Weibo did not return video information. The video may require access or be unavailable."
    );
  }

  const urls = playInfo.urls || {};

  const candidates = Object.values(urls)
    .map(jsonSafeUrl)
    .filter(Boolean);

  const uniqueUrls = [...new Set(candidates)];

  if (!uniqueUrls.length) {
    throw new Error(
      "No accessible video streams were returned by Weibo."
    );
  }

  return {
    success: true,
    platform: "Weibo",
    id: fid,
    author:
      playInfo.author ||
      playInfo.author_name ||
      "Unknown",
    text:
      playInfo.title ||
      playInfo.content1 ||
      "",
    media: uniqueUrls.map((videoUrl, index) => ({
      type: "video",
      url: videoUrl,
      quality: `Available stream ${index + 1}`
    }))
  };
}

async function parseStatusPost(url) {
  const match = url.pathname.match(
    /^\/(?:status|detail)\/(\d{10,20})\/?$/
  );

  const id =
    match?.[1] ||
    url.searchParams.get("layerid");

  if (!id || !/^\d{10,20}$/.test(id)) {
    throw new Error(
      "Unsupported Weibo post link format."
    );
  }

  const apiUrl =
    `https://m.weibo.cn/statuses/show?id=${encodeURIComponent(id)}`;

  const response = await fetch(apiUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36",
      "Referer": "https://m.weibo.cn/",
      "Accept": "application/json"
    },
    redirect: "error"
  });

  if (!response.ok) {
    throw new Error(
      `Weibo returned HTTP ${response.status}.`
    );
  }

  const result = await response.json();
  const post = result?.data;

  if (!post || typeof post !== "object") {
    throw new Error(
      "This post is unavailable or requires login."
    );
  }

  const media = extractMedia(post);

  if (!media.length) {
    throw new Error(
      "No downloadable media was found in this post."
    );
  }

  return {
    success: true,
    platform: "Weibo",
    id: String(post.id || id),
    author: post.user?.screen_name || "Unknown",
    text: post.text_raw || post.text || "",
    createdAt: post.created_at || null,
    media
  };
}

export async function parseWeibo(postUrl) {
  const url = new URL(postUrl);

  if (url.hostname === "video.weibo.com") {
    return parseVideoComponent(url);
  }

  if (
    url.hostname === "weibo.com" ||
    url.hostname === "www.weibo.com" ||
    url.hostname === "m.weibo.cn" ||
    url.hostname === "weibo.cn" ||
    url.hostname === "www.weibo.cn"
  ) {
    return parseStatusPost(url);
  }

  throw new Error("Unsupported Weibo domain.");
}

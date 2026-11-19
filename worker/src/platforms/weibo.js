const API_BASE = "https://m.weibo.cn/statuses/show";

const ALLOWED_MEDIA_HOSTS = [
  "sinaimg.cn",
  "weibocdn.com",
  "weibo.com",
  "video.weibo.com"
];

function isAllowedMediaUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      ALLOWED_MEDIA_HOSTS.some(host =>
        url.hostname === host || url.hostname.endsWith("." + host)
      )
    );
  } catch {
    return false;
  }
}

function safeUrl(value) {
  return typeof value === "string" && isAllowedMediaUrl(value)
    ? value
    : null;
}

function getVideoUrl(mediaInfo) {
  if (!mediaInfo) return null;

  const candidates = [
    mediaInfo.stream_url_hd,
    mediaInfo.mp4_720p_mp4,
    mediaInfo.mp4_hd_url,
    mediaInfo.stream_url,
    mediaInfo.mp4_sd_url
  ];

  return candidates.map(safeUrl).find(Boolean) || null;
}

function extractMedia(post) {
  const media = [];

  // Extract attached photos and Live Photos.
  for (const pic of post.pics || []) {
    const imageUrl = safeUrl(
      pic.large?.url || pic.original?.url || pic.url
    );

    const livePhotoUrl = safeUrl(pic.videoSrc);

    if (livePhotoUrl) {
      media.push({
        type: "livephoto",
        image: imageUrl,
        video: livePhotoUrl
      });
    } else if (imageUrl) {
      media.push({
        type: "image",
        url: imageUrl
      });
    }
  }

  // Extract an attached video, if present.
  const pageInfo = post.page_info;
  const mediaInfo = pageInfo?.media_info;

  const videoUrl = getVideoUrl(mediaInfo);

  if (videoUrl) {
    media.push({
      type: "video",
      url: videoUrl,
      thumbnail: safeUrl(
        pageInfo?.page_pic ||
        mediaInfo?.big_pic_info?.pic_big?.url
      ),
      duration: mediaInfo?.duration || null,
      quality: "best available"
    });
  }

  return media;
}

export async function parseWeibo(postUrl) {
  const url = new URL(postUrl);

  const match = url.pathname.match(
    /^\/(?:status|detail)\/(\d{10,20})\/?$/
  );

  const id =
    match?.[1] ||
    url.searchParams.get("layerid");

  if (!id || !/^\d{10,20}$/.test(id)) {
    throw new Error(
      "This Weibo link format is not supported yet. Please use a direct numeric status link."
    );
  }

  const apiUrl = `${API_BASE}?id=${encodeURIComponent(id)}`;

  const response = await fetch(apiUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36",
      "Referer": "https://m.weibo.cn/"
    },
    redirect: "error"
  });

  if (!response.ok) {
    throw new Error(
      `Weibo returned an error (${response.status}).`
    );
  }

  const result = await response.json();
  const post = result?.data;

  if (!post || typeof post !== "object") {
    throw new Error(
      "Weibo did not return an accessible public post. It may be private, deleted, or require login."
    );
  }

  const media = extractMedia(post);

  if (!media.length) {
    throw new Error(
      "No downloadable photos or videos were found in this post."
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

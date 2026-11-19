
const SUPPORTED_TYPES = new Set([
  "image",
  "gif",
  "video",
  "livephoto"
]);

function safeMediaUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  try {
    const url = new URL(value.trim());

    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password
    ) {
      return null;
    }

    const hostname = url.hostname.toLowerCase();

    // Reject local and private network destinations.
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("169.254.") ||
      /^172\.(1[6-9]|2[0-9]|3[01])\./.test(hostname)
    ) {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

function normalizeMediaItem(item, index = 0) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const type = String(item.type || "").toLowerCase();

  if (!SUPPORTED_TYPES.has(type)) {
    return null;
  }

  const normalized = {
    id: String(item.id || `media-${index + 1}`),
    type,
    url: null,
    thumbnail: null,
    filename: null,
    quality: item.quality || null,
    duration: item.duration || null
  };

  if (type === "livephoto") {
    normalized.image = safeMediaUrl(item.image);
    normalized.video = safeMediaUrl(item.video);

    if (!normalized.image && !normalized.video) {
      return null;
    }

    normalized.url = normalized.video || normalized.image;
    normalized.thumbnail = normalized.image;
  } else {
    normalized.url = safeMediaUrl(item.url);

    if (!normalized.url) {
      return null;
    }

    normalized.thumbnail = safeMediaUrl(
      item.thumbnail
    );
  }

  if (
    typeof item.filename === "string" &&
    item.filename.trim()
  ) {
    normalized.filename = item.filename
      .trim()
      .replace(/[\\/:*?"<>|]/g, "_")
      .slice(0, 120);
  }

  return normalized;
}

export function normalizeMedia(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item, index) =>
      normalizeMediaItem(item, index)
    )
    .filter(Boolean);
}

export function normalizeMediaResponse(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid media response.");
  }

  return {
    success: Boolean(data.success),
    platform: String(data.platform || "Unknown"),
    id: data.id ? String(data.id) : null,
    author: String(data.author || "Unknown"),
    text: String(data.text || ""),
    createdAt: data.createdAt || null,
    media: normalizeMedia(data.media),
    message: data.message || null
  };
}

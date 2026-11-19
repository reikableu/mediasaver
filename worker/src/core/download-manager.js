
const SUPPORTED_TYPES = new Set([
  "image",
  "gif",
  "video",
  "livephoto"
]);

const EXTENSIONS = {
  image: "jpg",
  gif: "gif",
  video: "mp4",
  livephoto: "jpg"
};

const VIDEO_EXTENSIONS = new Set([
  "mp4",
  "mov",
  "webm",
  "m4v"
]);

const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif"
]);

function safeFilename(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 100);
}

function getExtension(url, type) {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.([a-zA-Z0-9]+)$/);
    const extension = match?.[1]?.toLowerCase();

    if (
      type === "video" &&
      VIDEO_EXTENSIONS.has(extension)
    ) {
      return extension;
    }

    if (
      (type === "image" || type === "gif") &&
      IMAGE_EXTENSIONS.has(extension)
    ) {
      return extension;
    }
  } catch {
    // Use the default extension.
  }

  return EXTENSIONS[type] || "bin";
}

function validateDownloadUrl(value) {
  if (typeof value !== "string") return null;

  try {
    const url = new URL(value);

    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password
    ) {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

function createDownloadEntry({
  url,
  type,
  filename,
  index,
  part
}) {
  const safeUrl = validateDownloadUrl(url);

  if (!safeUrl) return null;

  const extension = getExtension(safeUrl, type);
  const baseName = safeFilename(filename) || "mediasaver";

  const suffix = part ? `_${part}` : "";

  return {
    id: `download-${index}${suffix}`,
    filename: `${baseName}_${index}${suffix}.${extension}`,
    url: safeUrl,
    type,
    extension,
    index
  };
}

export function createDownloadPlan(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid download information.");
  }

  if (!Array.isArray(data.media)) {
    throw new Error("No media items were supplied.");
  }

  const platform = safeFilename(
    data.platform || "media"
  ).toLowerCase();

  const postId = safeFilename(data.id || "post");

  const downloads = [];

  data.media.forEach((item, index) => {
    if (!item || typeof item !== "object") return;

    const type = String(item.type || "").toLowerCase();

    if (!SUPPORTED_TYPES.has(type)) return;

    const number = index + 1;

    const filename = `${platform}_${postId}`;

    if (type === "livephoto") {
      const image = createDownloadEntry({
        url: item.image,
        type: "image",
        filename,
        index: number,
        part: "photo"
      });

      const video = createDownloadEntry({
        url: item.video,
        type: "video",
        filename,
        index: number,
        part: "motion"
      });

      if (image) downloads.push(image);
      if (video) downloads.push(video);

      return;
    }

    const entry = createDownloadEntry({
      url: item.url,
      type,
      filename,
      index: number
    });

    if (entry) downloads.push(entry);
  });

  return {
    success: downloads.length > 0,
    platform,
    postId,
    totalFiles: downloads.length,
    downloads
  };
}

export function getDownloadSummary(plan) {
  if (!plan || !Array.isArray(plan.downloads)) {
    return {
      totalFiles: 0,
      images: 0,
      gifs: 0,
      videos: 0
    };
  }

  return {
    totalFiles: plan.downloads.length,
    images: plan.downloads.filter(
      item => item.type === "image"
    ).length,
    gifs: plan.downloads.filter(
      item => item.type === "gif"
    ).length,
    videos: plan.downloads.filter(
      item => item.type === "video"
    ).length
  };
}

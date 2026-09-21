const providers = [
  {
    name: "Google Photos",
    hosts: ["photos.google.com", "photos.app.goo.gl"],
    library: "https://photos.google.com/",
    help: "Open a photo or album, choose Share → Create link, then paste the shared link here.",
  },
  {
    name: "iCloud Photos",
    hosts: ["www.icloud.com", "icloud.com"],
    library: "https://www.icloud.com/photos/",
    help: "Use a Shared Album with Public Website enabled. Ordinary iCloud Links expire after 30 days.",
  },
  {
    name: "Google Drive",
    hosts: ["drive.google.com"],
    library: "https://drive.google.com/",
    help: "Share the photo or folder with Anyone with the link, then copy its link.",
  },
  {
    name: "OneDrive",
    hosts: ["onedrive.live.com", "1drv.ms"],
    library: "https://onedrive.live.com/",
    help: "Choose Share → Copy link. Use a view link your visitors can open.",
  },
  {
    name: "Dropbox",
    hosts: ["www.dropbox.com", "dropbox.com", "dl.dropboxusercontent.com"],
    library: "https://www.dropbox.com/home",
    help: "Copy a view-only shared link to a photo or folder.",
  },
  {
    name: "Flickr",
    hosts: ["www.flickr.com", "flickr.com", "flic.kr"],
    library: "https://www.flickr.com/",
    help: "Copy the public photo or album sharing link.",
  },
];
export { providers };
export function providerFor(value) {
  try {
    return (
      providers.find((p) =>
        p.hosts.includes(new URL(value).hostname.toLowerCase()),
      ) || null
    );
  } catch {
    return null;
  }
}
export function photoSource(photo) {
  return (
    photo.previewUrl ||
    (photo.kind === "image" && !photoLinkIssue(photo.url) ? photo.url : "")
  );
}
export function photoLinkIssue(value) {
  try {
    const url = new URL(value);
    if (
      url.hostname === "photos.google.com" &&
      !/^\/(?:u\/\d+\/)?share\//.test(url.pathname)
    )
      return "This is a Google Photos library link. Use Share → Create link in Google Photos, or drop the image onto this link to display it here.";
  } catch {}
  return "";
}
export function directPhoto(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return "";
    if (
      ["www.dropbox.com", "dropbox.com"].includes(url.hostname) &&
      /^\/(s|scl\/fi)\//.test(url.pathname) &&
      /\.(jpe?g|png|webp|gif)$/i.test(url.pathname)
    ) {
      url.searchParams.delete("dl");
      url.searchParams.set("raw", "1");
      return url.href;
    }
    if (!providerFor(value) && /\.(jpe?g|png|webp|gif)$/i.test(url.pathname))
      return url.href;
  } catch {}
  return "";
}
const decode = (value) =>
  value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, (token) => {
    const names = {
      "&amp;": "&",
      "&quot;": '"',
      "&apos;": "'",
      "&lt;": "<",
      "&gt;": ">",
    };
    if (names[token.toLowerCase()]) return names[token.toLowerCase()];
    const n =
      token[2].toLowerCase() === "x"
        ? parseInt(token.slice(3), 16)
        : parseInt(token.slice(2), 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
  });
function attributesOf(tag) {
  const attributes = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
    attributes[match[1].toLowerCase()] = decode(match[2] ?? match[3]);
  return attributes;
}
export function previewFromHtml(html, pageUrl = "") {
  // Google shared-photo pages render the selected image directly in their HTML
  // but often omit og:image. Match that photo's media key, never an avatar or a
  // neighbouring album image. Parse attributes only; never execute page scripts.
  try {
    const page = new URL(pageUrl);
    if (
      page.hostname === "photos.google.com" &&
      /^\/(?:u\/\d+\/)?share\//.test(page.pathname)
    ) {
      const selectedId = page.pathname.split("/photo/")[1]?.split("/")[0];
      for (const tag of html.match(/<[a-z][^>]*\bdata-media-key\s*=[^>]*>/gi) ||
        []) {
        const attributes = attributesOf(tag);
        if (selectedId && attributes["data-media-key"] !== selectedId) continue;
        if (!attributes["data-url"]) continue;
        const image = new URL(attributes["data-url"] || "");
        if (
          image.protocol === "https:" &&
          /^lh\d+\.googleusercontent\.com$/.test(image.hostname) &&
          /^\/(pw|p)\//.test(image.pathname)
        )
          return {
            previewUrl: image.href.split("=")[0] + "=w1400-h1400",
            title: "",
          };
      }
    }
  } catch {}
  const meta = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attributes = attributesOf(tag);
    const key = attributes.property || attributes.name;
    if (key && attributes.content) meta[key.toLowerCase()] = attributes.content;
  }
  const candidate =
    meta["og:image:secure_url"] ||
    meta["og:image"] ||
    meta["twitter:image"] ||
    "";
  let previewUrl = "";
  try {
    const url = new URL(candidate);
    if (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !/(logo|favicon|placeholder|\/icons?\/)/i.test(url.pathname)
    )
      previewUrl = url.href;
  } catch {}
  return { previewUrl, title: (meta["og:title"] || "").slice(0, 300) };
}
export async function resolvePhotoLink(value, fetcher = fetch) {
  const issue = photoLinkIssue(value);
  if (issue) return { previewUrl: "", message: issue };
  const direct = directPhoto(value);
  if (direct)
    return {
      previewUrl: direct,
      message: "Check the preview below, then choose it as your cover.",
    };
  const provider = providerFor(value);
  if (!provider)
    return {
      previewUrl: "",
      message:
        "Add a display photo or a direct image link below. Your original link will still open from the visit.",
    };
  const page = await fetchSharedPhotoPage(value, fetcher);
  const result = previewFromHtml(page.html, page.url);
  return {
    ...result,
    message: result.previewUrl
      ? "Preview found. Check it shows the photo you want before choosing your cover."
      : "This share page does not provide a usable preview. Choose a display photo below; the shared link will stay attached.",
  };
}

export async function fetchSharedPhotoPage(value, fetcher = fetch) {
  let current = value;
  const signal = AbortSignal.timeout(12000);
  for (let redirects = 0; redirects <= 4; redirects++) {
    const url = new URL(current);
    // No arbitrary proxy: every redirect stays on a recognised provider host.
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      !providerFor(current)
    )
      throw new Error(
        "This link redirects outside the supported photo services. Add a display photo instead.",
      );
    const response = await fetcher(current, {
      redirect: "manual",
      signal,
      headers: {
        "User-Agent": "EverOutward/1.0 (+https://quartz-oyster-7zxz.here.now)",
        Accept: "text/html",
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) break;
      current = new URL(location, current).href;
      continue;
    }
    if (
      !response.ok ||
      !response.headers.get("content-type")?.includes("text/html")
    ) {
      await response.body?.cancel();
      break;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2 * 1024 * 1024) {
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    return { html: Buffer.concat(chunks).toString("utf8"), url: current };
  }
  return { html: "", url: current };
}

export async function resolveMissingPhotoPreviews(
  photos,
  resolver = resolvePhotoLink,
) {
  return Promise.all(
    photos.map(async (photo) => {
      if (
        photoSource(photo) ||
        photoLinkIssue(photo.url) ||
        !providerFor(photo.url)
      )
        return photo;
      try {
        const result = await resolver(photo.url);
        return result.previewUrl && result.previewUrl.length <= 2000
          ? { ...photo, previewUrl: result.previewUrl }
          : photo;
      } catch {
        return photo;
      }
    }),
  );
}

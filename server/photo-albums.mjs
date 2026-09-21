import {
  fetchSharedPhotoPage,
  photoLinkIssue,
  providerFor,
} from "./photo-links.mjs";

export const MAX_VISIT_PHOTOS = 200;
export function photoIdentity(value) {
  try {
    const url = new URL(value);
    const match =
      url.hostname === "photos.google.com" &&
      url.pathname.match(/\/share\/[^/]+\/photo\/([^/]+)/);
    return match ? `google:${match[1]}` : url.href;
  } catch {
    return value;
  }
}

// Read JSON data already present in the public page. Never evaluate scripts.
function pageData(html) {
  const results = [];
  const start = /AF_initDataCallback\(\{[^]*?\bdata:\s*/g;
  let match;
  while ((match = start.exec(html))) {
    const begin = start.lastIndex;
    if (html[begin] !== "[") continue;
    let depth = 0,
      quoted = false,
      escaped = false;
    for (let i = begin; i < html.length; i++) {
      const c = html[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === "[" || c === "{") depth++;
      else if (c === "]" || c === "}") {
        depth--;
        if (depth === 0) {
          try {
            results.push(JSON.parse(html.slice(begin, i + 1)));
          } catch {}
          start.lastIndex = i + 1;
          break;
        }
      }
    }
  }
  return results;
}

export function googleAlbumFromHtml(html, albumUrl) {
  const album = new URL(albumUrl);
  if (
    album.hostname !== "photos.google.com" ||
    !/^\/(?:u\/\d+\/)?share\//.test(album.pathname)
  )
    throw new Error("Use Google Photos → Share → Create link for the album.");
  album.pathname = album.pathname.split("/photo/")[0];
  const images = new Map();
  const datasets = pageData(html);
  const stack = [...datasets];
  while (stack.length) {
    const item = stack.pop();
    if (!Array.isArray(item)) continue;
    if (
      typeof item[0] === "string" &&
      /^AF1Q[\w-]+$/.test(item[0]) &&
      Array.isArray(item[1]) &&
      typeof item[1][0] === "string" &&
      Number.isFinite(item[1][1]) &&
      Number.isFinite(item[1][2])
    ) {
      try {
        const image = new URL(item[1][0]);
        if (
          image.protocol === "https:" &&
          /^lh\d+\.googleusercontent\.com$/.test(image.hostname) &&
          /^\/(pw|p)\//.test(image.pathname)
        ) {
          const url = new URL(album.href);
          url.pathname += `/photo/${item[0]}`;
          images.set(item[0], {
            sourceId: item[0],
            url: url.href,
            previewUrl: image.href.split("=")[0] + "=w1400-h1400",
            caption: "",
            kind: "shared",
          });
        }
      } catch {}
    }
    for (let i = item.length - 1; i >= 0; i--)
      if (Array.isArray(item[i])) stack.push(item[i]);
  }
  return {
    albumUrl: album.href,
    photos: [...images.values()].slice(0, MAX_VISIT_PHOTOS),
    message:
      "These are the photos Google exposes on this shared page. Review the selection before adding; very large albums may expose only part of their contents.",
  };
}

export async function resolvePhotoAlbum(value, fetcher = fetch) {
  if (providerFor(value)?.name !== "Google Photos" || photoLinkIssue(value))
    throw new Error(
      "Use a Google Photos album sharing link (Share → Create link).",
    );
  let page = await fetchSharedPhotoPage(value, fetcher);
  const url = new URL(page.url);
  if (url.pathname.includes("/photo/")) {
    url.pathname = url.pathname.split("/photo/")[0];
    page = await fetchSharedPhotoPage(url.href, fetcher);
  }
  const result = googleAlbumFromHtml(page.html, page.url);
  if (!result.photos.length)
    throw new Error(
      "No photos could be read from this shared album. Check that link sharing is on, or drag the photos into this visit.",
    );
  return result;
}

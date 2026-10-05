import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { photoSource } from "./photo-links.mjs";

const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
const slug = (value) =>
  String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100) || "visit";
const safePath = (value) => /^\/visits\/[a-z0-9-]+\.html$/.test(value);

/** Reserve readable addresses, including withdrawn visits, so old links never change owners. */
export function visitSharePaths(visits, places, previous = {}) {
  const paths = Object.fromEntries(
    Object.entries(previous).filter(([, path]) => safePath(path)),
  );
  const used = new Set(Object.values(paths));
  const byPlace = new Map(places.map((p) => [p.id, p]));
  for (const visit of [...visits]
    .filter((v) => v.published)
    .sort(
      (a, b) =>
        (a.createdAt || "").localeCompare(b.createdAt || "") ||
        a.id.localeCompare(b.id),
    )) {
    if (paths[visit.id]) continue;
    const base = `${slug(byPlace.get(visit.placeId)?.name || "visit")}-${slug(visit.date)}`;
    let path = `/visits/${base}.html`,
      suffix = 2;
    while (used.has(path)) path = `/visits/${base}-${suffix++}.html`;
    paths[visit.id] = path;
    used.add(path);
  }
  return paths;
}

/** Real HTML metadata is available to social crawlers without executing the app. */
export async function writeVisitPages({
  root,
  template,
  visits,
  places,
  paths,
  siteUrl,
}) {
  await mkdir(join(root, "visits"), { recursive: true });
  const byPlace = new Map(places.map((p) => [p.id, p]));
  for (const visit of visits.filter((v) => v.published)) {
    const path = paths[visit.id];
    if (!safePath(path)) throw new Error("Missing readable visit address.");
    const place = byPlace.get(visit.placeId);
    const name = place?.name || "A visit";
    const title = `${name} · Ever Outward`;
    const description = (
      visit.summary ||
      `${visit.title ? visit.title + " · " : ""}Our visit to ${name} on ${visit.date}.`
    ).slice(0, 300);
    const cover =
      visit.photos.find((p) => p.id === visit.coverId && photoSource(p)) ||
      visit.photos.find((p) => photoSource(p));
    let image =
      (cover && photoSource(cover)) || place?.image || "/icons/gate-1024.png";
    // Uploaded display copies need a real image URL; crawlers can't use data URIs.
    if (image.startsWith("data:")) {
      const match = image.match(
        /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/,
      );
      if (!match) throw new Error("Unsupported visit preview image.");
      const data = Buffer.from(match[2], "base64");
      const hash = createHash("sha256").update(data).digest("hex").slice(0, 24);
      image = `/visit-images/${hash}.${match[1] === "jpeg" ? "jpg" : match[1]}`;
      await mkdir(join(root, "visit-images"), { recursive: true });
      await writeFile(join(root, image.slice(1)), data);
    }
    const absolute = (value) =>
      siteUrl ? new URL(value, siteUrl).href : value;
    const meta = (key, value, attribute = "property") =>
      `<meta ${attribute}="${key}" content="${escapeHtml(value)}" />`;
    const metadata = [
      `<title>${escapeHtml(title)}</title>`,
      meta("description", description, "name"),
      meta("eo:visit-id", visit.id, "name"),
      meta("og:type", "article"),
      meta("og:site_name", "Ever Outward"),
      meta("og:title", title),
      meta("og:description", description),
      meta("og:url", absolute(path)),
      meta("og:image", absolute(image)),
      meta("og:image:alt", cover?.caption || `Our visit to ${name}`),
      meta("twitter:card", "summary_large_image", "name"),
      meta("twitter:title", title, "name"),
      meta("twitter:description", description, "name"),
      meta("twitter:image", absolute(image), "name"),
      `<link rel="canonical" href="${escapeHtml(absolute(path))}" />`,
    ].join("\n    ");
    const html = template
      .replace(/<title>[\s\S]*?<\/title>/gi, "")
      .replace(
        /<meta\b[^>]*(?:name|property)="(?:description|og:[^"]*|twitter:[^"]*|eo:visit-id)"[^>]*>/gi,
        "",
      )
      .replace(/<link\b[^>]*rel="canonical"[^>]*>/gi, "")
      .replace("</head>", `${metadata}\n  </head>`);
    await writeFile(join(root, path.slice(1)), html);
  }
}

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createStore } from "./store.mjs";
import { publicVisit } from "./domain.mjs";

export const publishedVisitHash = (visit, homes = []) =>
  createHash("sha256")
    .update(JSON.stringify(publicVisit(visit, homes)))
    .digest("hex");
export function visitPublicationStatus(visit, publication, homes = []) {
  const previous = publication?.visits?.[visit.id];
  if (!visit.published)
    return previous ? "Removal pending publish" : "Only on this computer";
  if (!previous) return "Ready to publish";
  return previous === publishedVisitHash(visit, homes)
    ? "Published"
    : "Changes not yet published";
}

export function journalSnapshot(store) {
  const rows = store.snapshot();
  const records = rows.filter(
    (row) =>
      row.kind === "visits" ||
      row.kind === "routes" ||
      row.kind === "homes" ||
      row.kind === "placeCorrections" ||
      row.kind === "routeReviews" ||
      (row.kind === "settings" && ["home", "activeHomeId"].includes(row.id)),
  );
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(records))
    .digest("hex");
  return {
    fingerprint,
    visits: records
      .filter((r) => r.kind === "visits")
      .map((r) => JSON.parse(r.payload)),
    routes: records
      .filter((r) => r.kind === "routes")
      .map((r) => JSON.parse(r.payload)),
    home: JSON.parse(
      records.find((r) => r.kind === "settings" && r.id === "home")?.payload ||
        "null",
    ),
    homes: records
      .filter((r) => r.kind === "homes")
      .map((r) => JSON.parse(r.payload)),
    placeCorrections: records
      .filter((r) => r.kind === "placeCorrections")
      .map((r) => JSON.parse(r.payload)),
    activeHomeId:
      JSON.parse(
        records.find((r) => r.kind === "settings" && r.id === "activeHomeId")
          ?.payload || "null",
      )?.value || null,
  };
}
export function requireJournal(path) {
  if (!existsSync(path))
    throw new Error(
      "The local journal database is missing. Publication stopped to protect the live journal. Restore your database backup first.",
    );
  return createStore(path);
}
export function assertJournalUnchanged(path, expected) {
  const store = requireJournal(path);
  try {
    if (journalSnapshot(store).fingerprint !== expected)
      throw new Error(
        "The journal changed during publication. Your latest edits are saved locally; publish again to include them. The staged upload was not made live.",
      );
  } finally {
    store.close();
  }
}

// Link previews need absolute image URLs. The site's address is known once
// it has been published, so later publishes fill it in.
export function withSiteUrl(html, siteUrl) {
  if (!siteUrl) return html;
  return html.replace(
    /(<meta\s+(?:property|name)="(?:og:image|twitter:image)"\s+content=")([^"]*)"/g,
    (_, start, value) => `${start}${new URL(value, siteUrl).href}"`,
  );
}

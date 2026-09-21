import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { resolve, relative, join, extname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { cloudRequest, siteState } from "../server/herenow.mjs";
import { createStore } from "../server/store.mjs";
import {
  publicVisit,
  sortVisits,
  outward,
  publicRange,
} from "../server/domain.mjs";
import {
  journalSnapshot,
  requireJournal,
  assertJournalUnchanged,
} from "../server/publish-journal.mjs";

const exec = promisify(execFile);
const databasePath = resolve(".local/everoutward.sqlite");
const db = requireJournal(databasePath);
const backupPath = resolve(
  ".local/backups",
  `before-publish-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}.sqlite`,
);
db.backup(backupPath);
await exec(process.execPath, ["node_modules/typescript/bin/tsc", "-b"], {
  maxBuffer: 1024 * 1024,
});
await exec(process.execPath, ["node_modules/vite/bin/vite.js", "build"], {
  maxBuffer: 1024 * 1024,
});
const catalogue = JSON.parse(await readFile("public/data/places.json", "utf8"));
const snapshot = journalSnapshot(db);
const visits = sortVisits(snapshot.visits.filter((v) => v.published)).map(
  publicVisit,
);
const progress = outward(
  catalogue.places,
  visits,
  snapshot.home,
  snapshot.routes,
);
const range = publicRange(catalogue.places, visits, snapshot.home, progress);
db.close();
await writeFile(
  "dist/data/history.json",
  JSON.stringify({
    visits,
    queue: progress.ranked.map(({ id, metres, seconds }) => ({
      placeId: id,
      metres,
      seconds,
    })),
    complete: progress.complete,
    pendingCount: progress.blockingPendingCount,
    range,
    publishedAt: new Date().toISOString(),
  }),
);
await mkdir("dist/.herenow", { recursive: true });
await writeFile(
  "dist/.herenow/data.json",
  JSON.stringify(
    {
      collections: {
        comments: {
          fields: {
            visit_id: {
              type: "string",
              required: true,
              maxLength: 80,
              trim: true,
            },
            photo_id: { type: "string", maxLength: 80, default: "" },
            name: { type: "string", required: true, maxLength: 80, trim: true },
            body: {
              type: "string",
              required: true,
              maxLength: 2000,
              trim: true,
            },
          },
          access: {
            read: "public",
            insert: "public",
            update: "owner",
            delete: "owner",
          },
          rateLimit: "10/hour/ip",
        },
      },
    },
    null,
    2,
  ),
);
const root = resolve("dist");
const paths = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (!entry.name.endsWith(".map")) paths.push(full);
  }
}
await walk(root);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};
const files = await Promise.all(
  paths.map(async (full) => {
    const data = await readFile(full);
    return {
      path: relative(root, full).replaceAll("\\", "/"),
      size: data.length,
      contentType: types[extname(full)] || "application/octet-stream",
      hash: createHash("sha256").update(data).digest("hex"),
    };
  }),
);
const existing = await siteState();
if (existing.slug) {
  const live = await cloudRequest(`/api/v1/publish/${existing.slug}`);
  if (existing.versionId && live.currentVersionId !== existing.versionId)
    throw new Error(
      "The live site changed since the last publish. Review the live version before overwriting it.",
    );
}
const response = await cloudRequest(
  existing.slug ? `/api/v1/publish/${existing.slug}` : "/api/v1/publish",
  {
    method: existing.slug ? "PUT" : "POST",
    body: JSON.stringify({
      files,
      ttlSeconds: null,
      spaMode: true,
      displayName: "Ever Outward: The Next Gate",
      displayDescription:
        "Our National Trust visits, photographs and memories. One home base. One next gate.",
      ...(existing.versionId ? { baseVersionId: existing.versionId } : {}),
    }),
  },
);
// Persist the new project binding before uploads so a retry updates this site.
await mkdir(".herenow", { recursive: true });
await writeFile(
  ".herenow/state.json",
  JSON.stringify(
    {
      ...existing,
      slug: response.slug,
      siteUrl: response.siteUrl,
      pendingVersionId: response.upload.versionId,
    },
    null,
    2,
  ),
);
for (let offset = 0; offset < response.upload.uploads.length; offset += 5) {
  await Promise.all(
    response.upload.uploads.slice(offset, offset + 5).map(async (target) => {
      const r = await fetch(target.url, {
        method: "PUT",
        headers: target.headers,
        body: await readFile(join(root, target.path)),
        signal: AbortSignal.timeout(60000),
      });
      if (!r.ok)
        throw new Error(`Upload failed for ${target.path}: ${r.status}`);
    }),
  );
}
assertJournalUnchanged(databasePath, snapshot.fingerprint);
const result = await cloudRequest(`/api/v1/publish/${response.slug}/finalize`, {
  method: "POST",
  body: JSON.stringify({ versionId: response.upload.versionId }),
});

let pendingLocalChanges = false;
try {
  assertJournalUnchanged(databasePath, snapshot.fingerprint);
} catch {
  pendingLocalChanges = true;
}
const state = {
  slug: response.slug,
  siteUrl: result.siteUrl,
  versionId: result.currentVersionId,
  publishedAt: new Date().toISOString(),
  publishStatus: result.publishStatus,
  pendingLocalChanges,
  publishedVisitCount: visits.length,
};
await writeFile(".herenow/state.json", JSON.stringify(state, null, 2));
// Pinning is a dashboard operation, separate from permanent account hosting.
try {
  const pin = await cloudRequest(`/api/me/pins/${response.slug}`, {
    method: "PUT",
  });
  state.pinnedAt = pin.pinnedAt || null;
} catch {
  state.pinStatus =
    "Publish succeeded; pinning requires the here.now dashboard.";
}
await writeFile(".herenow/state.json", JSON.stringify(state, null, 2));
// Move comments entered before the first deployment into the shared collection.
const localStore = createStore(resolve(".local/everoutward.sqlite"));
try {
  for (const comment of localStore
    .list("comments")
    .filter((c) => visits.some((v) => v.id === c.visitId))) {
    await cloudRequest(`/api/v1/publishes/${response.slug}/data/comments`, {
      method: "POST",
      headers: { "Idempotency-Key": `local-${comment.id}` },
      body: JSON.stringify({
        visit_id: comment.visitId,
        photo_id: comment.photoId || "",
        name: comment.name,
        body: comment.body,
      }),
    });
    localStore.delete("comments", comment.id);
  }
} finally {
  localStore.close();
}
if (result.warnings?.length)
  throw new Error(
    "The site published with manifest warnings: " +
      JSON.stringify(result.warnings),
  );
console.log(JSON.stringify(state));

import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { resolve, relative, join, extname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createPublishJobs } from "../server/publish-jobs.mjs";
import { cloudRequest, siteState } from "../server/herenow.mjs";
import { createStore } from "../server/store.mjs";
import { migrateHomes, publicJournal } from "../server/homes.mjs";
import { sortVisits } from "../server/domain.mjs";
import {
  journalSnapshot,
  requireJournal,
  assertJournalUnchanged,
  publishedVisitHash,
} from "../server/publish-journal.mjs";

const exec = promisify(execFile);
export async function publishWebsite(progress = () => {}) {
  progress("Backing up your local journal…");
  const databasePath = resolve(".local/everoutward.sqlite");
  const db = requireJournal(databasePath);
  const backupPath = resolve(
    ".local/backups",
    `before-publish-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}.sqlite`,
  );
  db.backup(backupPath);
  migrateHomes(db);
  progress("Building the website…");
  await exec(process.execPath, ["node_modules/typescript/bin/tsc", "-b"], {
    maxBuffer: 1024 * 1024,
  });
  await exec(process.execPath, ["node_modules/vite/bin/vite.js", "build"], {
    maxBuffer: 1024 * 1024,
  });
  const catalogue = JSON.parse(
    await readFile("public/data/places.json", "utf8"),
  );
  const snapshot = journalSnapshot(db);
  const journal = publicJournal(
    catalogue.places,
    sortVisits(snapshot.visits),
    snapshot.homes,
    snapshot.routes,
    snapshot.activeHomeId,
  );
  const visits = journal.visits;
  db.close();
  await writeFile(
    "dist/data/history.json",
    JSON.stringify({ ...journal, publishedAt: new Date().toISOString() }),
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
              name: {
                type: "string",
                required: true,
                maxLength: 80,
                trim: true,
              },
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
  progress(`Preparing ${visits.length} selected visits for upload…`);
  if (existing.slug) {
    const live = await cloudRequest(`/api/v1/publish/${existing.slug}`);
    // A lost finalisation response may have left a known staged version live.
    if (existing.pendingVersionId === live.currentVersionId)
      existing.versionId = live.currentVersionId;
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
          "Our National Trust visits, photographs and memories. Shared discoveries from every home. One next gate.",
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
    progress(
      `Uploading website files (${offset} of ${response.upload.uploads.length})…`,
    );
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
  progress("Making the uploaded website live…");
  let result;
  try {
    result = await cloudRequest(`/api/v1/publish/${response.slug}/finalize`, {
      method: "POST",
      body: JSON.stringify({ versionId: response.upload.versionId }),
    });
  } catch (error) {
    const live = await cloudRequest(`/api/v1/publish/${response.slug}`).catch(
      () => null,
    );
    if (live?.currentVersionId !== response.upload.versionId) throw error;
    result = {
      siteUrl: response.siteUrl,
      currentVersionId: live.currentVersionId,
      publishStatus: live.publishStatus || existing.publishStatus,
    };
  }

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
    warnings: result.warnings || [],
  };
  await writeFile(".herenow/state.json", JSON.stringify(state, null, 2));
  // Move comments entered before the first deployment into the shared collection.
  const localStore = createStore(resolve(".local/everoutward.sqlite"));
  try {
    localStore.put("settings", "lastPublication", {
      versionId: state.versionId,
      publishedAt: state.publishedAt,
      visits: Object.fromEntries(
        snapshot.visits
          .filter((v) => v.published)
          .map((v) => [v.id, publishedVisitHash(v, snapshot.homes)]),
      ),
    });
    for (const comment of localStore
      .list("comments")
      .filter((c) => visits.some((v) => v.id === c.visitId))) {
      try {
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
      } catch {
        state.warnings.push(
          "The website is live, but some local comments could not be uploaded. They remain saved on this computer; publish again to retry.",
        );
        break;
      }
    }
  } finally {
    localStore.close();
  }
  await writeFile(".herenow/state.json", JSON.stringify(state, null, 2));
  return state;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const store = requireJournal(resolve(".local/everoutward.sqlite"));
  try {
    const jobs = createPublishJobs({ store });
    let job = jobs.start(),
      message;
    while (job.status === "running") {
      if (job.message !== message) {
        message = job.message;
        console.log(message);
      }
      await delay(1000);
      job = jobs.status();
    }
    if (job.status !== "succeeded") throw new Error(job.error);
    console.log(JSON.stringify(job.result));
  } finally {
    store.close();
  }
}

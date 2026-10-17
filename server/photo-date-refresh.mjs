import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  albumLink,
  photoIdentity,
  resolvePhotoAlbum,
} from "./photo-albums.mjs";
import { sortPhotos, validTakenAt } from "./photo-dates.mjs";

/** Recover missing dates only, matching the original photo identity, never album position. */
export async function refreshPhotoDates(
  store,
  { write = false, resolveAlbum = resolvePhotoAlbum, progress = () => {} } = {},
) {
  const visits = store.list("visits");
  const albums = new Set(
    visits.flatMap((visit) =>
      (visit.photos || [])
        .filter((photo) => !validTakenAt(photo.takenAt))
        .map((photo) => albumLink([photo]))
        .filter(Boolean),
    ),
  );
  const dates = new Map();
  const failures = [];
  let completed = 0;
  for (const album of albums) {
    try {
      const result = await resolveAlbum(album);
      for (const photo of result.photos) {
        if (validTakenAt(photo.takenAt))
          dates.set(photoIdentity(photo.url), photo.takenAt);
      }
    } catch (error) {
      failures.push({ album, message: error.message });
    }
    progress(`Read shared album ${++completed} of ${albums.size}.`);
  }
  let recovered = 0;
  const changes = [];
  for (const visit of visits) {
    let count = 0;
    const photos = (visit.photos || []).map((photo) => {
      const takenAt = dates.get(photoIdentity(photo.url));
      if (validTakenAt(photo.takenAt) || !takenAt) return photo;
      count++;
      return { ...photo, takenAt };
    });
    if (count) {
      recovered += count;
      changes.push({ before: visit, photos: sortPhotos(photos) });
    }
  }
  let backupPath;
  if (write && changes.length) {
    backupPath = join(
      dirname(store.filename),
      "backups",
      `before-photo-dates-${Date.now()}-${randomUUID()}.sqlite`,
    );
    store.backup(backupPath);
    store.transaction(() => {
      for (const change of changes) {
        if (
          JSON.stringify(store.get("visits", change.before.id)) !==
          JSON.stringify(change.before)
        )
          throw new Error(
            "A visit changed while reading capture dates. Nothing was updated; run the refresh again.",
          );
      }
      for (const change of changes)
        store.put("visits", change.before.id, {
          ...change.before,
          photos: change.photos,
          updatedAt: new Date().toISOString(),
        });
    });
  }
  return {
    albums: albums.size,
    visits: changes.length,
    recovered,
    failures,
    backupPath,
    written: write && changes.length > 0,
  };
}

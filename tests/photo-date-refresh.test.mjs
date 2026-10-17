import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../server/store.mjs";
import { refreshPhotoDates } from "../server/photo-date-refresh.mjs";

function fixture(t) {
  const store = createStore(":memory:");
  t.after(() => store.close());
  const photo = (id, extra = {}) => ({
    id,
    url: `https://photos.google.com/share/album/photo/AF1Q${id}?key=example`,
    caption: `${id} caption`,
    ...extra,
  });
  const visit = {
    id: "visit",
    coverId: "late",
    notes: "Keep this story",
    photos: [
      photo("late"),
      photo("manual", { takenAt: "2026-10-17T08:00:00" }),
      photo("early"),
      photo("missing"),
    ],
  };
  store.put("visits", visit.id, visit);
  store.put("comments", "comment", {
    photoId: "late",
    body: "Keep this comment",
  });
  const resolveAlbum = async () => ({
    photos: [
      photo("early", { takenAt: "2026-10-17T09:00:00Z" }),
      photo("late", { takenAt: "2026-10-17T12:00:00Z" }),
      photo("manual", { takenAt: "2026-10-17T20:00:00Z" }),
    ],
  });
  return { store, visit, resolveAlbum };
}

test("existing albums recover missing times by identity, preserve edits and comments, and back up before writing", async (t) => {
  const { store, visit, resolveAlbum } = fixture(t);
  const backups = [];
  store.backup = (path) => {
    backups.push(path);
    assert.deepEqual(store.get("visits", visit.id), visit);
  };
  const dryRun = await refreshPhotoDates(store, { resolveAlbum });
  assert.equal(dryRun.recovered, 2);
  assert.equal(dryRun.albums, 1);
  assert.deepEqual(store.get("visits", visit.id), visit);
  assert.equal(backups.length, 0);
  const result = await refreshPhotoDates(store, { resolveAlbum, write: true });
  assert.equal(result.written, true);
  assert.equal(backups.length, 1);
  const saved = store.get("visits", visit.id);
  assert.deepEqual(
    saved.photos.map((photo) => photo.id),
    ["manual", "early", "late", "missing"],
  );
  assert.equal(saved.photos[0].takenAt, visit.photos[1].takenAt);
  assert.equal(saved.notes, visit.notes);
  assert.equal(saved.coverId, visit.coverId);
  assert.equal(saved.photos[2].caption, visit.photos[0].caption);
  assert.equal(store.get("comments", "comment").photoId, "late");
  assert.equal(
    (await refreshPhotoDates(store, { resolveAlbum, write: true })).recovered,
    0,
  );
  assert.equal(backups.length, 1);
});

test("concurrent edits cancel every update and an unavailable album leaves the visit untouched", async (t) => {
  const { store, visit, resolveAlbum } = fixture(t);
  store.backup = () => {};
  await assert.rejects(
    refreshPhotoDates(store, {
      write: true,
      resolveAlbum: async (album) => {
        store.put("visits", visit.id, { ...visit, notes: "New owner edit" });
        return resolveAlbum(album);
      },
    }),
    /visit changed/,
  );
  assert.equal(store.get("visits", visit.id).notes, "New owner edit");
  assert.deepEqual(store.get("visits", visit.id).photos, visit.photos);
  const result = await refreshPhotoDates(store, {
    write: true,
    resolveAlbum: async () => {
      throw new Error("Unavailable");
    },
  });
  assert.equal(result.failures.length, 1);
  assert.equal(result.written, false);
  assert.equal(store.get("visits", visit.id).notes, "New owner edit");
});

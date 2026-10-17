import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  photoTakenAt,
  sortPhotos,
  validTakenAt,
} from "../server/photo-dates.mjs";
import { captureExif, withCaptureExif } from "./helpers/photo-metadata.mjs";
import { googleAlbumFromHtml } from "../server/photo-albums.mjs";
import { visitSchema } from "../server/app.mjs";
import { publicVisit } from "../server/domain.mjs";

test("chronological ordering respects offsets, fractions, stable ties and undated legacy photos without mutation", () => {
  const photos = [
    { id: "unknown" },
    { id: "later", takenAt: "2026-10-17T11:22:33.123999+01:00" },
    { id: "first", takenAt: "2026-10-17T10:22:33.123001Z" },
    { id: "tie", takenAt: "2026-10-17T10:22:33.123001" },
    { id: "invalid", takenAt: "2026-02-30T00:00:00" },
  ];
  assert.deepEqual(
    sortPhotos(photos).map((p) => p.id),
    ["first", "tie", "later", "unknown", "invalid"],
  );
  assert.equal(photos[0].id, "unknown");
  assert.deepEqual(sortPhotos(photos.slice(0, 1)), photos.slice(0, 1));
  for (const value of [
    "2026-02-29T12:00:00",
    "2026-10-17T24:00:00",
    "2026-10-17T10:20:60",
    "2026-10-17T10:20:00+14:30",
    "",
    null,
  ])
    assert.equal(validTakenAt(value), false);
  assert.equal(validTakenAt("2024-02-29T23:59:59-05:30"), true);
});

test("original capture time survives JPEG, PNG and WebP extraction; absent or corrupt metadata is harmless", async () => {
  const tiff = captureExif();
  const jpeg = withCaptureExif(readFileSync("public/photos/ramsey.jpg"));
  // PNG's eXIf payload is raw TIFF; CRC is irrelevant to the metadata reader.
  const chunk = Buffer.alloc(12 + tiff.length);
  chunk.writeUInt32BE(tiff.length);
  chunk.write("eXIf", 4);
  tiff.copy(chunk, 8);
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk,
    Buffer.alloc(12),
  ]);
  const webp = Buffer.alloc(20 + tiff.length);
  webp.write("RIFF");
  webp.writeUInt32LE(webp.length - 8, 4);
  webp.write("WEBPEXIF", 8);
  webp.writeUInt32LE(tiff.length, 16);
  tiff.copy(webp, 20);
  for (const bytes of [jpeg, png, webp])
    assert.equal(await photoTakenAt(bytes), "2026-10-17T11:22:33.123+01:00");
  const naive = withCaptureExif(
    readFileSync("public/photos/ramsey.jpg"),
    "2026:10:17 11:22:33",
    "",
    "",
  );
  assert.equal(await photoTakenAt(naive), "2026-10-17T11:22:33");
  for (const bytes of [
    Buffer.alloc(0),
    Buffer.from("corrupt"),
    readFileSync("public/photos/ramsey.jpg"),
    webp.subarray(0, 23),
  ])
    assert.equal(await photoTakenAt(bytes), undefined);
});

test("Google album capture timestamps order imports before undated entries", () => {
  const media = (id, time) => [
    id,
    [`https://lh3.googleusercontent.com/pw/${id}`, 1200, 800],
    time,
  ];
  const html = `AF_initDataCallback({data:${JSON.stringify([media("AF1Qlate", Date.parse("2026-10-17T12:00:00Z")), media("AF1Qunknown", null), media("AF1Qearly", Date.parse("2026-10-17T09:00:00Z"))])}});`;
  const photos = googleAlbumFromHtml(
    html,
    "https://photos.google.com/share/test",
  ).photos;
  assert.deepEqual(
    photos.map((p) => p.sourceId),
    ["AF1Qearly", "AF1Qlate", "AF1Qunknown"],
  );
  assert.equal(photos[0].takenAt, "2026-10-17T09:00:00.000Z");
  assert.equal(photos[2].takenAt, undefined);
});

test("saving and publishing retain capture times and photo identities while sorting; malformed times are rejected", () => {
  const photo = (id, takenAt) => ({
    id,
    takenAt,
    url: `https://example.com/${id}.jpg`,
    caption: id,
    kind: "image",
  });
  const base = {
    placeId: "place",
    date: "2026-10-17",
    title: "",
    summary: "",
    notes: "",
    rating: null,
    photos: [
      photo("late", "2026-10-17T12:00:00"),
      photo("early", "2026-10-17T09:00:00"),
    ],
    coverId: "late",
    published: true,
  };
  const saved = visitSchema.parse(base);
  assert.deepEqual(
    saved.photos.map((p) => p.id),
    ["early", "late"],
  );
  assert.equal(saved.coverId, "late");
  assert.equal(saved.photos[0].takenAt, "2026-10-17T09:00:00");
  assert.deepEqual(publicVisit(base).photos, saved.photos);
  assert.equal(
    visitSchema.safeParse({ ...base, photos: [photo("bad", "yesterday")] })
      .success,
    false,
  );
});

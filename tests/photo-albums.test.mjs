import { test } from "node:test";
import assert from "node:assert/strict";
import {
  albumLink,
  googleAlbumFromHtml,
  resolvePhotoAlbum,
  photoIdentity,
} from "../server/photo-albums.mjs";
import { visitSchema } from "../server/app.mjs";

const media = (id, host = "lh3.googleusercontent.com") => [
  id,
  [`https://${host}/pw/${id}`, 1200, 800],
  'quoted " brace ]',
];
const html = `<script>AF_initDataCallback({key:'ds:1',hash:'2',data:${JSON.stringify([null, [media("AF1Qone"), media("AF1Qtwo"), media("AF1Qone"), media("AF1Qbad", "attacker.example")]])},sideChannel:{}});</script>`;
test("album reads public JSON media, deduplicates, preserves share key and skips outside image hosts", () => {
  const result = googleAlbumFromHtml(
    html,
    "https://photos.google.com/share/album?key=access",
  );
  assert.deepEqual(
    result.photos.map((p) => p.sourceId),
    ["AF1Qone", "AF1Qtwo"],
  );
  assert.equal(
    result.photos[0].url,
    "https://photos.google.com/share/album/photo/AF1Qone?key=access",
  );
  assert.equal(
    result.photos[0].previewUrl,
    "https://lh3.googleusercontent.com/pw/AF1Qone=w1400-h1400",
  );
  assert.equal(
    photoIdentity(result.photos[0].url),
    photoIdentity(
      "https://photos.google.com/share/another/photo/AF1Qone?key=other",
    ),
  );
  assert.match(result.message, /only part/);
  assert.equal(
    googleAlbumFromHtml(
      "AF_initDataCallback({data:[alert('never execute')]});",
      result.albumUrl,
    ).photos.length,
    0,
  );
});
test("album resolves short sharing links, rejects private links and unsafe redirects", async () => {
  const fetcher = async (url) =>
    url.includes("goo.gl")
      ? new Response(null, {
          status: 302,
          headers: {
            location: "https://photos.google.com/share/album?key=access",
          },
        })
      : new Response(html, { headers: { "content-type": "text/html" } });
  assert.equal(
    (await resolvePhotoAlbum("https://photos.app.goo.gl/album", fetcher)).photos
      .length,
    2,
  );
  await assert.rejects(
    resolvePhotoAlbum("https://photos.google.com/album/private", () => {
      throw Error("must not fetch");
    }),
    /sharing link/,
  );
  await assert.rejects(
    resolvePhotoAlbum(
      "https://photos.app.goo.gl/bad",
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1" },
        }),
    ),
    /outside/,
  );
});
test("visits accept an album selection but enforce count and total display-copy size", () => {
  const base = {
    placeId: "a",
    date: "2026-09-01",
    title: "",
    summary: "",
    notes: "",
    rating: null,
    published: true,
    coverId: null,
  };
  const photos = Array.from({ length: 200 }, (_, i) => ({
    id: String(i),
    url: `https://example.com/${i}.jpg`,
    caption: "",
    kind: "image",
  }));
  assert.equal(visitSchema.safeParse({ ...base, photos }).success, true);
  assert.equal(
    visitSchema.safeParse({
      ...base,
      photos: [...photos, { ...photos[0], id: "201" }],
    }).success,
    false,
  );
  assert.equal(
    visitSchema.safeParse({
      ...base,
      photos: photos.slice(0, 12).map((p) => ({
        ...p,
        previewUrl: "data:image/jpeg;base64," + "A".repeat(700000),
      })),
    }).success,
    false,
  );
});
test("album link prefers a saved album and otherwise derives it from imported photos", () => {
  const imported = {
    kind: "shared",
    url: "https://photos.google.com/share/album/photo/AF1Qone?key=access",
  };
  assert.equal(
    albumLink([imported]),
    "https://photos.google.com/share/album?key=access",
  );
  assert.equal(
    albumLink([
      imported,
      { kind: "album", url: "https://photos.app.goo.gl/saved" },
    ]),
    "https://photos.app.goo.gl/saved",
  );
  assert.equal(
    albumLink([{ kind: "image", url: "https://example.org/a.jpg" }]),
    null,
  );
  assert.equal(albumLink([{ kind: "shared", url: "" }]), null);
});

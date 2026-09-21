import { test } from "node:test";
import assert from "node:assert/strict";
import {
  photoLinkIssue,
  resolveMissingPhotoPreviews,
  providerFor,
  directPhoto,
  photoSource,
  previewFromHtml,
  resolvePhotoLink,
} from "../server/photo-links.mjs";
import { visitSchema } from "../server/app.mjs";
import { publicVisit } from "../server/domain.mjs";

test("Google shared photo HTML selects the matching image even without Open Graph metadata", () => {
  const html = `<c-wiz data-media-key="selected"></c-wiz>
    <c-wiz data-media-key="other" data-url="https://lh3.googleusercontent.com/pw/other"></c-wiz>
    <c-wiz data-media-key="selected" data-url="https://lh3.googleusercontent.com/pw/selected"></c-wiz>`;
  assert.equal(
    previewFromHtml(
      html,
      "https://photos.google.com/share/album/photo/selected?key=test",
    ).previewUrl,
    "https://lh3.googleusercontent.com/pw/selected=w1400-h1400",
  );
  assert.equal(
    previewFromHtml(
      html,
      "https://photos.google.com/share/album/photo/missing?key=test",
    ).previewUrl,
    "",
  );
  assert.equal(
    previewFromHtml(html, "https://example.com/share/album/photo/selected")
      .previewUrl,
    "",
  );
  assert.equal(
    previewFromHtml(
      '<c-wiz data-media-key="selected" data-url="https://lh3.googleusercontent.com/a/avatar"></c-wiz>',
      "https://photos.google.com/share/album/photo/selected",
    ).previewUrl,
    "",
  );
});

test("private Google library URLs are explained without fetching account-only images", async () => {
  for (const url of [
    "https://photos.google.com/photo/private-id",
    "https://photos.google.com/u/1/photo/private-id",
    "https://photos.google.com/album/private-album",
  ]) {
    assert.match(photoLinkIssue(url), /Share → Create link/);
    const result = await resolvePhotoLink(url, () => {
      throw new Error("must not fetch");
    });
    assert.equal(result.previewUrl, "");
    assert.match(result.message, /library link/);
    assert.equal(photoSource({ url, kind: "image" }), "");
  }
  assert.equal(photoLinkIssue("https://photos.app.goo.gl/shared-id"), "");
  assert.equal(
    photoLinkIssue(
      "https://photos.google.com/share/shared-id/photo/photo-id?key=abc",
    ),
    "",
  );
});

test("saving fills missing shared previews and preserves chosen photos and original links", async () => {
  const photos = [
    { id: "shared", url: "https://photos.app.goo.gl/example", kind: "shared" },
    {
      id: "private",
      url: "https://photos.google.com/photo/private",
      kind: "shared",
    },
    {
      id: "chosen",
      url: "https://photos.app.goo.gl/chosen",
      kind: "shared",
      previewUrl: "https://example.com/chosen.jpg",
    },
  ];
  let calls = 0;
  const result = await resolveMissingPhotoPreviews(photos, async () => {
    calls++;
    return { previewUrl: "https://example.com/preview.jpg" };
  });
  assert.equal(calls, 1);
  assert.equal(result[0].url, photos[0].url);
  assert.equal(result[0].previewUrl, "https://example.com/preview.jpg");
  assert.deepEqual(result.slice(1), photos.slice(1));
  assert.equal(photos[0].previewUrl, undefined);
});

test("recognises provider hosts without accepting lookalikes, preserves Dropbox access parameters", () => {
  assert.equal(
    providerFor("https://photos.app.goo.gl/example").name,
    "Google Photos",
  );
  assert.equal(
    providerFor("https://photos.google.com.attacker.example/foo"),
    null,
  );
  assert.equal(
    providerFor("https://www.icloud.com/sharedalbum/#test").name,
    "iCloud Photos",
  );
  const direct = new URL(
    directPhoto(
      "https://www.dropbox.com/scl/fi/example/garden.jpg?rlkey=secret&dl=0",
    ),
  );
  assert.equal(direct.searchParams.get("rlkey"), "secret");
  assert.equal(direct.searchParams.get("raw"), "1");
  assert.equal(direct.searchParams.has("dl"), false);
  assert.equal(directPhoto("https://www.dropbox.com/scl/fo/folder"), "");
});
test("shared link resolves public preview metadata; missing preview remains an honest link", async () => {
  const calls = [];
  const result = await resolvePhotoLink(
    "https://photos.app.goo.gl/sample",
    async (url, options) => {
      calls.push(url);
      assert.equal(options.redirect, "manual");
      return calls.length === 1
        ? new Response(null, {
            status: 302,
            headers: { location: "https://photos.google.com/share/sample" },
          })
        : new Response(
            '<meta content="https://lh3.googleusercontent.com/example?a=1&amp;b=2" property="og:image"><meta property="og:title" content="A &amp; B">',
            { headers: { "content-type": "text/html" } },
          );
    },
  );
  assert.equal(calls.length, 2);
  assert.equal(
    result.previewUrl,
    "https://lh3.googleusercontent.com/example?a=1&b=2",
  );
  assert.equal(result.title, "A & B");
  assert.equal(
    previewFromHtml('<meta property="og:image" content="javascript:alert(1)">')
      .previewUrl,
    "",
  );
  assert.equal(
    previewFromHtml(
      '<meta property="og:image" content="https://example.com/logo.png">',
    ).previewUrl,
    "",
  );
  const unavailable = await resolvePhotoLink(
    "https://www.icloud.com/sharedalbum/#sample",
    async () =>
      new Response("<html></html>", {
        headers: { "content-type": "text/html" },
      }),
  );
  assert.equal(unavailable.previewUrl, "");
  assert.match(unavailable.message, /display photo/);
});
test("preview fetch rejects outside redirects and does not fetch arbitrary or local URLs", async () => {
  let calls = 0;
  await assert.rejects(
    resolvePhotoLink("https://photos.app.goo.gl/example", async () => {
      calls++;
      return new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/private" },
      });
    }),
    /outside/,
  );
  assert.equal(calls, 1);
  const result = await resolvePhotoLink("https://127.0.0.1/private", () => {
    throw new Error("must not fetch");
  });
  assert.equal(result.previewUrl, "");
});
test("shared albums and dropped photos can be covers; missing previews and unsafe data are rejected", () => {
  const base = {
    placeId: "a",
    date: "2026-09-01",
    title: "",
    summary: "",
    notes: "",
    rating: null,
    published: true,
    coverId: "photo",
    photos: [],
  };
  const shared = {
    id: "photo",
    url: "https://photos.app.goo.gl/sample",
    kind: "album",
    caption: "Garden",
    previewUrl: "https://example.com/photo.jpg",
  };
  const saved = visitSchema.parse({ ...base, photos: [shared] });
  assert.equal(photoSource(saved.photos[0]), shared.previewUrl);
  assert.equal(publicVisit(saved).photos[0].previewUrl, shared.previewUrl);
  assert.equal(
    visitSchema.safeParse({ ...base, photos: [{ ...shared, previewUrl: "" }] })
      .success,
    false,
  );
  const uploaded = {
    ...shared,
    url: "",
    kind: "image",
    previewUrl: "data:image/jpeg;base64,/9j/AA==",
  };
  assert.equal(
    visitSchema.safeParse({ ...base, photos: [uploaded] }).success,
    true,
  );
  for (const previewUrl of [
    "data:image/svg+xml;base64,PHN2Zz4=",
    "javascript:alert(1)",
    "http://example.com/image.jpg",
  ])
    assert.equal(
      visitSchema.safeParse({ ...base, photos: [{ ...shared, previewUrl }] })
        .success,
      false,
    );
});

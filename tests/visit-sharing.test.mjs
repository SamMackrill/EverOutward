import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { createApp } from "../server/app.mjs";
import { createStore } from "../server/store.mjs";
import { visitSharePaths, writeVisitPages } from "../server/visit-sharing.mjs";
import { currentView } from "../src/visitRoute.ts";

const place = {
  id: "p",
  name: "Château & Gardens",
  image: "/destination.jpg",
  lat: 52,
  lng: 0,
};
const visit = (id, extra = {}) => ({
  id,
  placeId: "p",
  date: "2026-10-05",
  title: "Our day",
  summary: "Lovely gardens",
  notes: "",
  photos: [],
  coverId: null,
  published: true,
  createdAt: "2026-10-05T12:00:00Z",
  ...extra,
});

test("visit pages, public history navigation and legacy hash routes select the correct visit", (t) => {
  const originalLocation = globalThis.location;
  const originalDocument = globalThis.document;
  t.after(() => {
    if (originalLocation === undefined) delete globalThis.location;
    else globalThis.location = originalLocation;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  });
  const first = "/visits/gardens-2026-10-05.html";
  const second = "/visits/gardens-2026-10-04.html";
  globalThis.location = { pathname: first, hash: "" };
  globalThis.document = {
    querySelector: (selector) =>
      selector.includes("canonical")
        ? { href: "https://journal.example" + first }
        : { content: "first" },
  };
  assert.equal(currentView(), "visit/first");
  const visits = [
    { id: "first", sharePath: first },
    { id: "second", sharePath: second },
  ];
  globalThis.location.pathname = second;
  assert.equal(currentView(visits), "visit/second");
  globalThis.location.pathname = "/";
  globalThis.location.hash = "#timeline";
  assert.equal(currentView(visits), "timeline");
  globalThis.location.hash = "#visit/legacy-uuid";
  assert.equal(currentView(visits), "visit/legacy-uuid");
  globalThis.location.hash = "";
  assert.equal(currentView(visits), "map");
});

test("readable addresses handle repeat visits and remain reserved across edits and withdrawal", () => {
  const visits = [visit("b"), visit("a"), visit("draft", { published: false })];
  const paths = visitSharePaths(visits, [place]);
  assert.deepEqual(paths, {
    a: "/visits/chateau-gardens-2026-10-05.html",
    b: "/visits/chateau-gardens-2026-10-05-2.html",
  });
  assert.deepEqual(visitSharePaths(visits.reverse(), [place]), paths);
  const next = visitSharePaths(
    [visit("a", { date: "2026-11-01" }), visit("c")],
    [{ ...place, name: "Renamed gardens" }],
    paths,
  );
  assert.equal(next.a, paths.a);
  assert.equal(next.b, paths.b);
  const replacement = visitSharePaths([visit("c")], [place], paths);
  assert.equal(replacement.c, "/visits/chateau-gardens-2026-10-05-3.html");
  assert.equal(
    visitSharePaths([visit("a")], [place], { a: "../../private.txt" }).a,
    paths.a,
  );
});

test("generated HTML serves per-visit metadata and cover bytes without JavaScript, excludes drafts, and escapes text", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "everoutward-sharing-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const coverBytes = Buffer.from("test uploaded display copy");
  const cover = {
    id: "cover",
    kind: "image",
    url: `data:image/jpeg;base64,${coverBytes.toString("base64")}`,
    caption: 'Garden "gate" & trees',
  };
  const visits = [
    visit("a", {
      summary: '"><script>alert(1)</script>',
      photos: [
        { id: "first", kind: "image", url: "https://images.example/first.jpg" },
        cover,
      ],
      coverId: "cover",
    }),
    visit("b", {
      photos: [
        {
          id: "linked",
          kind: "shared",
          url: "https://photos.example/album",
          previewUrl: "https://images.example/preview.jpg",
        },
      ],
    }),
    visit("fallback"),
    visit("draft", { published: false, summary: "PRIVATE" }),
  ];
  const paths = visitSharePaths(visits, [place]);
  const template = await readFile("index.html", "utf8");
  await writeVisitPages({
    root,
    template,
    visits,
    places: [place],
    paths,
    siteUrl: "https://journal.example/",
  });
  const app = express();
  app.use(express.static(root));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => new Promise((r) => server.close(r)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(origin + paths.a);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(
    html,
    /og:title" content="Château &amp; Gardens · Ever Outward"/,
  );
  assert.match(html, /name="eo:visit-id" content="a"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(
    html,
    /og:url" content="https:\/\/journal.example\/visits\/chateau-gardens-2026-10-05.html"/,
  );
  assert.match(html, /&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(
    html,
    /<script>alert|data:image|PRIVATE|The Next Gate<\/title>/,
  );
  assert.equal((html.match(/property="og:image"/g) || []).length, 1);
  const imageUrl = html.match(/property="og:image" content="([^"]+)"/)[1];
  const imageResponse = await fetch(origin + new URL(imageUrl).pathname);
  assert.equal(imageResponse.headers.get("content-type"), "image/jpeg");
  assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), coverBytes);
  const linked = await readFile(join(root, paths.b.slice(1)), "utf8");
  assert.match(
    linked,
    /og:image" content="https:\/\/images.example\/preview.jpg"/,
  );
  const fallback = await readFile(join(root, paths.fallback.slice(1)), "utf8");
  assert.match(
    fallback,
    /og:image" content="https:\/\/journal.example\/destination.jpg"/,
  );
  assert.equal((await readdir(join(root, "visits"))).length, 3);
});

test("owner sharing uses the last public URL and never exposes a local or unpublished link", async (t) => {
  const store = createStore(":memory:");
  for (const v of [
    visit("live"),
    visit("new"),
    visit("withdrawn", { published: false }),
  ])
    store.put("visits", v.id, v);
  store.put("settings", "lastPublication", {
    siteUrl: "https://journal.example/",
    visits: { live: "hash", withdrawn: "hash" },
    sharePaths: {
      live: "/visits/gardens-2026-10-05.html",
      withdrawn: "/visits/gardens-2026-09-01.html",
    },
  });
  const app = createApp({
    store,
    places: [place],
    localOwner: true,
    enableCloud: false,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    store.close();
  });
  const data = await (
    await fetch(`http://127.0.0.1:${server.address().port}/api/state`)
  ).json();
  assert.equal(
    data.visits.find((v) => v.id === "live").shareUrl,
    "https://journal.example/visits/gardens-2026-10-05.html",
  );
  assert.equal(data.visits.find((v) => v.id === "new").shareUrl, undefined);
  assert.equal(
    data.visits.find((v) => v.id === "withdrawn").shareUrl,
    undefined,
  );
});

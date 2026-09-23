import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import express from "express";
import { createApp } from "../server/app.mjs";
import { createStore } from "../server/store.mjs";
import { currentHome, originFor } from "../server/homes.mjs";

const catalogue = JSON.parse(await readFile("public/data/places.json", "utf8"));
const ramsey = catalogue.places.find(
  (p) => p.name === "Ramsey Abbey Gatehouse",
);
const store = createStore(":memory:");
const app = createApp({
  store,
  places: catalogue.places,
  initialHome: { label: "Girton", lat: 52.24, lng: 0.07, version: "t" },
  enableCloud: false,
});
const home = currentHome(store);
const image = (id) => ({
  id,
  url: `https://timeline.test/${id}.jpg`,
  caption: "",
  kind: "image",
});
const base = {
  placeId: ramsey.id,
  title: "",
  summary: "",
  notes: "",
  rating: 4,
  published: true,
  createdAt: "2026-01-01T12:00:00Z",
  updatedAt: "2026-01-01T12:00:00Z",
};
const visits = {
  first: {
    ...base,
    date: "2026-01-15",
    attendees: ["Ana", "Sam"],
    photos: [image("a")],
    coverId: "a",
    startingHomeSnapshot: {
      label: "Old flat",
      colour: "#000",
      lat: 52,
      lng: 0,
    },
  },
  second: {
    ...base,
    date: "2026-02-15",
    attendees: ["Ele"],
    // The only photo is broken, so the card falls back to the place photo.
    photos: [image("broken-cover")],
    coverId: "broken-cover",
    ...originFor(home),
  },
  third: {
    ...base,
    date: "2026-03-15",
    attendees: ["Ana", "Ele"],
    photos: [
      ...Array.from({ length: 14 }, (_, i) => image(`good-${i}`)),
      image("broken-late"),
      {
        id: "shared",
        url: "https://photos.google.com/share/alb/photo/AF1Qx?key=k",
        previewUrl: "https://timeline.test/broken-preview.jpg",
        caption: "",
        kind: "shared",
      },
    ],
    coverId: "good-0",
    ...originFor(home),
  },
};
for (const [id, visit] of Object.entries(visits))
  store.put("visits", id, { ...visit, id });
app.use(express.static(resolve("dist")));
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = `http://127.0.0.1:${server.address().port}`;
process.env.APP_ORIGIN = origin;
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1200, height: 900 },
});
await context.grantPermissions(["clipboard-read", "clipboard-write"], {
  origin,
});
// Exercise the copy-link fallback rather than the system share sheet.
await context.addInitScript(() => delete Navigator.prototype.share);
await context.route("**/tile.openstreetmap.org/**", (r) => r.abort());
await context.route("https://timeline.test/**", (r) =>
  r.request().url().includes("broken")
    ? r.fulfill({ status: 404 })
    : r.fulfill({
        contentType: "image/png",
        path: resolve("public/icons/gate-512.png"),
      }),
);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  const html = await (await fetch(origin)).text();
  assert.match(
    html,
    /<meta property="og:image" content="\/icons\/gate-1024.png"/,
  );
  await page.goto(`${origin}/#timeline`);
  const cards = page.locator(".visit-card");
  await cards.first().waitFor();
  assert.equal(await cards.count(), 3);
  assert.equal(await page.title(), "Our timeline · Ever Outward");
  const card = (date) => cards.filter({ hasText: date });

  // Repeat visits are numbered; facts replace the repeated origin.
  assert.equal(
    await card("15 March 2026").locator(".repeat-badge").innerText(),
    "3rd visit",
  );
  assert.equal(
    await card("15 February 2026").locator(".repeat-badge").innerText(),
    "2nd visit",
  );
  assert.equal(
    await card("15 January 2026").locator(".repeat-badge").count(),
    0,
  );
  assert.match(
    await card("15 March 2026").locator(".visit-facts").innerText(),
    /16 photos\s*With Ana, Ele/,
  );
  assert.doesNotMatch(await card("15 March 2026").innerText(), /From Girton/);
  assert.match(await card("15 January 2026").innerText(), /From Old flat/);
  assert.doesNotMatch(
    await cards.first().innerText(),
    /A new memory in our National Trust journey/,
  );

  // One real link per card.
  const link = card("15 March 2026").getByRole("link");
  assert.equal(await link.count(), 1);
  assert.equal(await link.getAttribute("href"), "#visit/third");
  assert.equal(
    await card("15 March 2026")
      .locator("a, button, [tabindex]:not([tabindex='-1'])")
      .count(),
    1,
  );
  assert.equal(
    await page.getByRole("link", { name: "Our timeline" }).getAttribute("href"),
    "#timeline",
  );

  // A failed cover falls back to the place's own photo.
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".visit-card .visit-image img")].some((img) =>
      img.getAttribute("src")?.includes("ramsey"),
    ),
  );

  // Person chips filter the timeline.
  const chips = page.getByRole("group", { name: "Who came" });
  assert.equal(
    await chips
      .getByRole("button", { name: "Everyone" })
      .getAttribute("aria-pressed"),
    "true",
  );
  await chips.getByRole("button", { name: "Ele", exact: true }).click();
  assert.equal(await cards.count(), 2);
  await chips.getByRole("button", { name: "Sam", exact: true }).click();
  assert.equal(await cards.count(), 1);
  await chips.getByRole("button", { name: "Everyone" }).click();
  assert.equal(await cards.count(), 3);

  // Visit page: header order, gallery batching and failed previews.
  await link.click();
  await page
    .getByRole("heading", { level: 1, name: "Ramsey Abbey Gatehouse" })
    .waitFor();
  assert.equal(
    await page.title(),
    "Ramsey Abbey Gatehouse · 15 Mar 2026 · Ever Outward",
  );
  assert.equal(
    await page.locator(".location-line > span:not(.stars)").count(),
    0,
  );
  assert.match(
    await page.locator(".visit-meta").innerText(),
    /With Ana, Ele\s*From Girton\s*Leave a note/,
  );
  const tiles = page.locator(".visit-photo-grid button");
  assert.equal(await tiles.count(), 12);
  assert.equal(await page.locator(".visit-photo-grid span").count(), 0);
  assert.match(
    await tiles.first().locator("img").getAttribute("alt"),
    /^Photo 1 of \d+, Ramsey Abbey Gatehouse, 15 March 2026$/,
  );
  await page.getByRole("button", { name: /^Show all \d+ photos$/ }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".visit-photo-grid button").length === 14,
  );
  assert.match(
    await page.locator(".photo-unavailable").innerText(),
    /2 photos are in the Google Photos album/,
  );
  assert.equal(
    await page
      .locator(".photo-unavailable")
      .getByRole("link", { name: "Open album" })
      .getAttribute("href"),
    "https://photos.google.com/share/alb?key=k",
  );
  assert.equal(await page.locator(".empty-photo").count(), 0);

  // Notes are counted near the top and in the section heading.
  assert.equal(
    await page.locator("#visit-notes .count-label").innerText(),
    "No notes yet — be the first",
  );
  await page.getByLabel("Your name", { exact: true }).fill("Guest");
  await page.getByLabel("Your comment", { exact: true }).fill("Lovely day");
  await page.getByRole("button", { name: "Post comment" }).click();
  await page.locator("#visit-notes .count-label").getByText("1 note").waitFor();
  await page.locator(".visit-meta").getByText("1 note").waitFor();

  // Share copies the visit link when the share sheet isn't available.
  await page.getByRole("button", { name: "Share" }).click();
  await page.getByRole("button", { name: "Link copied" }).waitFor();
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    `${origin}/#visit/third`,
  );

  // Modifier clicks are left to the browser (new tab), not in-app navigation.
  await page.goto(`${origin}/#timeline`);
  const [popup] = await Promise.all([
    context.waitForEvent("page"),
    card("15 January 2026")
      .getByRole("link")
      .click({ modifiers: ["ControlOrMeta", "Shift"] }),
  ]);
  await popup.waitForLoadState();
  assert.equal(new URL(popup.url()).hash, "#visit/first");
  assert.equal(new URL(page.url()).hash, "#timeline");
  await popup.close();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: link preview tags, repeat-visit badges, card facts and one link per card, cover fallback, person chips, page titles, header order, 12-photo gallery with show all, hidden failed previews with album link, note counts, copy link and new-tab links.",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  store.close();
}

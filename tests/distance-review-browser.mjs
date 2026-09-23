import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import express from "express";
import { createApp } from "../server/app.mjs";
import { createStore } from "../server/store.mjs";
import { currentHome, routeKey, publicJournal } from "../server/homes.mjs";
import {
  applyPlaceCorrections,
  publicPlaceOverrides,
} from "../server/distance-review.mjs";

const { places } = JSON.parse(
  await readFile("public/data/places.json", "utf8"),
);
const catalogue = places
  .slice(0, 8)
  .map((p, i) => ({ ...p, lat: 52 + i * 0.001, lng: 0.02 }));
const boatPlace = places.find(
  (p) => p.id === "c5ab4c3d-40f4-416f-be3e-6c8c6d0ecf5c",
);
catalogue.push(boatPlace);
const target = catalogue[0],
  store = createStore(":memory:");
let queued = 0;
const app = createApp({
  store,
  places: catalogue,
  initialHome: { label: "Home A", lat: 52, lng: 0, version: "one" },
  localOwner: true,
  enableCloud: false,
  autoPublish: true,
  publisher: {
    status: () => null,
    enqueue: () => {
      queued++;
      return { id: "test", status: "running" };
    },
  },
  routeFetcher: async () => ({
    ok: true,
    json: async () => ({
      code: "Ok",
      sources: [{ distance: 0 }],
      destinations: [{ distance: 0 }, { distance: 1800 }],
      distances: [[0, 12000]],
      durations: [[0, 900]],
    }),
  }),
});
const a = currentHome(store),
  b = { ...a, id: "second", label: "Home B" };
store.put("homes", b.id, b);
store.put("visits", "boat-trip", {
  id: "boat-trip",
  placeId: boatPlace.id,
  date: "2026-09-01",
  title: "Island day",
  summary: "A day by boat",
  notes: "",
  attendees: [],
  photos: [],
  coverId: null,
  rating: null,
  published: true,
  createdAt: "old",
  updatedAt: "old",
  startingHomeId: a.id,
});
for (const h of [a, b]) {
  for (const [i, p] of catalogue.entries())
    if (i && p.id !== boatPlace.id)
      store.put("routes", routeKey(h, p.id), {
        homeId: h.id,
        homeVersion: h.version,
        placeId: p.id,
        metres: i * 1000,
        seconds: i * 100,
      });
  store.put("routeReports", JSON.stringify([h.id, h.version]), {
    unavailablePlaces: [
      {
        placeId: target.id,
        name: target.name,
        reason: "Entrance needs checking",
      },
    ],
  });
}
app.get("/data/places.json", (req, res) => res.json({ places: catalogue }));
app.use(express.static(resolve("dist")));
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = `http://127.0.0.1:${server.address().port}`;
process.env.APP_ORIGIN = origin;
const browser = await chromium.launch(),
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(12000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.route("**/tile.openstreetmap.org/**", (r) => r.abort());
const section = page.locator(".distance-review-section");
const open = async () => {
  await section
    .getByRole("button", { name: `Review ${target.name}`, exact: true })
    .click();
  await page.locator("dialog").waitFor();
};
const save = async (name) => {
  await page.getByRole("button", { name, exact: true }).click();
  await page.locator("dialog").waitFor({ state: "detached" });
};
try {
  await page.goto(origin);
  await page.getByRole("link", { name: "Our timeline", exact: true }).click();
  await page.locator(".visit-card .boat-notice svg").waitFor();
  await page.getByRole("link", { name: "Workspace", exact: true }).click();
  await section
    .getByLabel("Distances from", { exact: true })
    .selectOption(b.id);
  await open();
  assert.equal(currentHome(store).id, a.id);
  await page
    .getByLabel("Verified distance (miles)", { exact: true })
    .fill("50");
  await page.getByLabel("Travel time (minutes)", { exact: true }).fill("80");
  await page
    .getByLabel("Route source (shown publicly)", { exact: true })
    .fill("Verified Waze journey");
  await page
    .getByLabel("Private review notes", { exact: true })
    .fill("Keep my evidence private");
  await save("Save review and publish");
  assert.equal(store.get("routes", routeKey(b, target.id)).metres, 80467.2);
  assert.equal(store.get("routes", routeKey(a, target.id)), null);
  await section
    .getByLabel("Show distances", { exact: true })
    .selectOption("resolved");
  await open();
  await page.getByLabel("Review action", { exact: true }).selectOption("flag");
  await page
    .getByLabel("What needs checking?", { exact: true })
    .fill("Wrong car park");
  await save("Save review and publish");
  await section
    .getByLabel("Show distances", { exact: true })
    .selectOption("needs-review");
  await open();
  await page
    .getByLabel("Review action", { exact: true })
    .selectOption("entrance");
  await page.getByLabel("Entrance latitude", { exact: true }).fill("52.02");
  await page.getByLabel("Entrance longitude", { exact: true }).fill("0.025");
  await page
    .getByLabel("Source used to verify the entrance", { exact: true })
    .fill("https://www.nationaltrust.org.uk/visit");
  await page
    .getByLabel("Public access note", { exact: true })
    .fill("Continue on foot from the road.");
  await save("Save entrance and recalculate");
  for (const h of [a, b])
    assert.equal(
      store.get("routes", routeKey(h, target.id)).walkingMetres,
      1800,
    );
  assert.equal(queued, 3);
  assert.equal(currentHome(store).id, a.id);
  await section
    .getByLabel("Show distances", { exact: true })
    .selectOption("resolved");
  await section.getByText(/approx. 1.8 km walk/).waitFor();
  await page.getByRole("radio", { name: "Dark theme", exact: true }).check();
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(tmpdir(), "everoutward-distance-review-desktop.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await open();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: join(tmpdir(), "everoutward-distance-review-mobile.png"),
  });
  await page
    .getByRole("button", { name: "Close distance review", exact: true })
    .click();
  const corrected = applyPlaceCorrections(
    catalogue,
    store.list("placeCorrections"),
  );
  const journal = publicJournal(
    corrected,
    store.list("visits"),
    store.list("homes"),
    store.list("routes"),
    a.id,
  );
  journal.placeOverrides = publicPlaceOverrides(store.list("placeCorrections"));
  assert(!journal.queue.some((r) => r.placeId === target.id));
  assert(!JSON.stringify(journal).includes("Keep my evidence private"));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route("**/api/session", (r) =>
    r.fulfill({
      json: { local: false, owner: false, passwordConfigured: true },
    }),
  );
  await page.route("**/data/history.json", (r) => r.fulfill({ json: journal }));
  await page.goto(origin);
  await page.getByRole("link", { name: "Our timeline", exact: true }).click();
  await page
    .locator(".visit-card .boat-notice")
    .getByText("Boat trip required", { exact: true })
    .waitFor();
  await page.screenshot({ path: join(tmpdir(), "everoutward-boat-visit.png") });
  await page.getByRole("link", { name: "Map", exact: true }).click();
  await page.getByRole("button", { name: "Find a place", exact: true }).click();
  await page
    .getByLabel("Search National Trust places", { exact: true })
    .fill(target.name);
  await page.locator(".search-results").getByRole("button").first().click();
  await page
    .locator("dialog")
    .getByText(/7.5 mi by road/)
    .waitFor();
  await page
    .locator("dialog")
    .getByText(/approx. 1.1 mi walk/)
    .waitFor();
  await page
    .locator("dialog")
    .getByText("Continue on foot from the road.", { exact: true })
    .waitFor();
  assert.match(
    await page
      .getByRole("link", { name: "Open Waze", exact: true })
      .getAttribute("href"),
    /52.02,0.025/,
  );
  await page.keyboard.press("Escape");
  await page
    .getByLabel("Search National Trust places", { exact: true })
    .fill(boatPlace.name);
  await page.locator(".search-results").getByRole("button").first().click();
  await page.locator("dialog .boat-notice svg").waitFor();
  await page
    .locator("dialog")
    .getByText("Boat trip required", { exact: true })
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: per-home review, manual correction, flag, entrance retry for all homes, walking estimates, automatic publish queue, mobile layout and public corrections beyond the next five.",
  );
} catch (error) {
  console.error(errors, (await page.locator("body").innerText()).slice(-5000));
  await page.screenshot({
    path: join(tmpdir(), "everoutward-distance-review-failure.png"),
  });
  throw error;
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  store.close();
}

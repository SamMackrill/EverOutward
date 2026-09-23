import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import express from "express";
import { createApp } from "../server/app.mjs";
import { createStore } from "../server/store.mjs";
import { currentHome, routeKey, publicJournal } from "../server/homes.mjs";
const { places } = JSON.parse(
  await readFile("public/data/places.json", "utf8"),
);
const store = createStore(":memory:");
// Synthetic nearby catalogue entries ensure two independently visible circles.
const catalogue = places
  .slice(0, 7)
  .map((p, i) => ({ ...p, lat: 52 + i * 0.015, lng: 0.02 }));
const app = createApp({
  store,
  places: catalogue,
  initialHome: { label: "CB3 0LL", lat: 52.001, lng: 0.01, version: "v1" },
  localOwner: true,
  enableCloud: false,
});
const firstHome = currentHome(store);
store.put("visits", "existing", {
  id: "existing",
  placeId: catalogue[1].id,
  date: "2026-01-01",
  title: "Existing trip",
  notes: "",
  summary: "",
  attendees: [],
  photos: [],
  coverId: null,
  rating: null,
  published: true,
  createdAt: "old",
  updatedAt: "old",
  startingHomeId: firstHome.id,
  startingHomeVersion: firstHome.version,
  startingHomeSnapshot: {
    label: firstHome.label,
    colour: firstHome.colour,
    lat: firstHome.lat,
    lng: firstHome.lng,
  },
});
function fillRoutes(home, reverse = false) {
  catalogue.forEach((p, i) =>
    store.put("routes", routeKey(home, p.id), {
      homeId: home.id,
      homeVersion: home.version,
      placeId: p.id,
      metres: 8000 + (reverse ? catalogue.length - i : i) * 1000,
      seconds: 300,
      checkedAt: "2026-09-01",
      source: "Test",
    }),
  );
  // The nearest unvisited place by road must sit beyond the visited point.
  store.put("routes", routeKey(home, catalogue[0].id), {
    homeId: home.id,
    homeVersion: home.version,
    placeId: catalogue[0].id,
    metres: 50000,
    seconds: 300,
    checkedAt: "2026-09-01",
    source: "Test",
  });
}
fillRoutes(firstHome);
app.get("/data/places.json", (req, res) => res.json({ places: catalogue }));
app.use(express.static(resolve("dist")));
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = `http://127.0.0.1:${server.address().port}`;
process.env.APP_ORIGIN = origin;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.route("**/tile.openstreetmap.org/**", (r) => r.abort());
const card = (label) =>
  page
    .locator(".home-location-card")
    .filter({ has: page.getByRole("heading", { name: label, exact: true }) });
try {
  await page.goto(origin);
  await page.getByRole("link", { name: "Workspace", exact: true }).click();
  await page
    .getByRole("button", { name: "Add home location", exact: true })
    .click();
  await page.getByLabel("Home name", { exact: true }).fill("Family base");
  await page.getByLabel("Close home dialog").click();
  await page.getByRole("alertdialog").waitFor();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  assert.equal(
    await page.getByLabel("Home name", { exact: true }).inputValue(),
    "Family base",
  );
  await page.getByLabel("Colour", { exact: true }).fill("#3569a0");
  await page.getByLabel("Latitude", { exact: true }).fill("51.99");
  await page.getByLabel("Longitude", { exact: true }).fill("-0.03");
  await page
    .getByRole("button", { name: "Save home location", exact: true })
    .click();
  await card("Family base").waitFor();
  assert.doesNotMatch(
    await page.locator(".home-location-list").innerText(),
    /Discovery circle:\s*0\.0 miles\b/,
  );
  assert.match(
    await card("Family base")
      .getByRole("button", { name: "Remove", exact: true })
      .getAttribute("class"),
    /danger/,
  );
  const secondHome = store.list("homes").find((h) => h.label === "Family base");
  assert.equal(currentHome(store).id, firstHome.id);
  fillRoutes(secondHome, true);
  // One missing distance can affect the queue without changing either circle.
  store.delete("routes", routeKey(firstHome, catalogue[6].id));
  await page.reload();
  await card("Family base")
    .getByRole("button", { name: "Make current", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Current home location"]')
        ?.selectedOptions[0]?.textContent === "Family base",
  );
  await page.getByRole("link", { name: "Map", exact: true }).click();
  await page.getByRole("button", { name: "All homes", exact: true }).click();
  await page.locator(".home-map-label").first().waitFor();
  await page.waitForFunction(
    () => document.querySelectorAll(".home-map-label").length === 2,
  );
  assert.equal(await page.locator(".home-map-label").count(), 2);
  // Map labels carry only the home name; status detail moves to the title.
  assert.deepEqual(
    (await page.locator(".home-map-label").allInnerTexts()).sort(),
    ["CB3 0LL", "Family base"],
  );
  assert.equal(await page.locator(".home-map-label .current-dot").count(), 1);
  assert.equal(await page.locator(".rank-marker").count(), 5);
  assert.deepEqual(
    (await page.locator(".rank-marker .rank-pin b").allInnerTexts()).sort(),
    ["1", "2", "3", "4", "5"],
  );
  assert.equal(await page.locator(".current-home-circle").count(), 1);
  assert.equal(await page.locator(".other-home-circle").count(), 1);
  assert.equal(
    await page.locator(".current-home-circle").getAttribute("stroke-width"),
    "4",
  );
  assert.equal(
    await page.locator(".other-home-circle").getAttribute("stroke-dasharray"),
    "5 5",
  );
  await page.getByRole("radio", { name: "Dark theme", exact: true }).check();
  await page.screenshot({
    path: join(tmpdir(), "everoutward-multiple-homes-map.png"),
  });
  const publicPage = await browser.newPage();
  const twoHomes = publicJournal(
    catalogue,
    store.list("visits"),
    store.list("homes"),
    store.list("routes"),
    secondHome.id,
  );
  assert.equal(
    twoHomes.homes.find((h) => h.id === firstHome.id).complete,
    false,
  );
  assert.equal(
    twoHomes.homes.find((h) => h.id === firstHome.id).range.confirmed,
    true,
  );
  assert.equal(
    await page
      .locator(".home-map-label")
      .filter({ hasText: "circle pending" })
      .count(),
    0,
  );
  await publicPage.route("**/tile.openstreetmap.org/**", (r) => r.abort());
  await publicPage.route("**/api/session", (r) =>
    r.fulfill({
      json: { local: false, owner: false, passwordConfigured: true },
    }),
  );
  await publicPage.route("**/data/history.json", (r) =>
    r.fulfill({
      json: {
        ...twoHomes,
        homes: [
          ...twoHomes.homes,
          {
            ...twoHomes.homes[0],
            id: "distant",
            label: "Distant home",
            queue: [],
            complete: false,
            range: {
              centre: { lat: 54.3, lng: -5.6 },
              radius: 8000,
              confirmed: true,
              approximate: true,
            },
          },
        ],
      },
    }),
  );
  await publicPage.goto(origin);
  await publicPage
    .getByLabel("Current home location", { exact: true })
    .selectOption(firstHome.id);
  const publicNext = catalogue.find(
    (p) =>
      p.id ===
      twoHomes.homes.find((h) => h.id === firstHome.id).queue[0].placeId,
  );
  await publicPage
    .getByRole("heading", { name: publicNext.name, exact: true })
    .first()
    .waitFor();
  assert.equal(
    currentHome(store).id,
    secondHome.id,
    "public selection must not change the owner's current home",
  );
  assert.equal(await publicPage.locator(".current-home-circle").count(), 1);
  await publicPage
    .getByLabel("Current home location", { exact: true })
    .selectOption("distant");
  await publicPage.locator(".current-home-circle").waitFor();
  assert.notEqual(
    await publicPage.locator(".current-home-circle").getAttribute("d"),
    "M0 0",
    "changing to a distant home must bring its circle into view",
  );
  await publicPage.close();
  await page
    .getByRole("button", { name: "Record a visit", exact: true })
    .click();
  assert.match(
    await page.locator("dialog .origin-line").innerText(),
    /From\s+Family base/,
  );
  await page.getByRole("button", { name: "Change starting home" }).click();
  assert.equal(
    await page.getByLabel("Started from", { exact: true }).inputValue(),
    secondHome.id,
  );
  await page
    .getByLabel("Started from", { exact: true })
    .selectOption(firstHome.id);
  await page
    .getByRole("combobox", { name: "National Trust place" })
    .fill(catalogue[2].name);
  await page
    .getByRole("option")
    .filter({ hasText: catalogue[2].name })
    .first()
    .click();
  await page
    .getByLabel("A title for the day", { exact: false })
    .fill("Trip from original home");
  await page
    .getByLabel("Include in the public journal", { exact: false })
    .check();
  await page.getByRole("button", { name: "Save visit", exact: true }).click();
  await page.locator("dialog").waitFor({ state: "detached" });
  await page.getByRole("link", { name: "Our timeline", exact: true }).click();
  await page
    .getByRole("heading", { name: "Trip from original home", exact: true })
    .waitFor();
  assert.equal(
    store.list("visits").find((v) => v.title === "Trip from original home")
      .startingHomeId,
    firstHome.id,
  );
  await page.getByText("From CB3 0LL", { exact: true }).last().waitFor();
  await page.getByRole("link", { name: "Workspace", exact: true }).click();
  await card("CB3 0LL")
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await page.getByLabel("Home name", { exact: true }).fill("Original home");
  await page.getByLabel("Colour", { exact: true }).fill("#9a711c");
  await page
    .getByRole("button", { name: "Save home location", exact: true })
    .click();
  await card("Original home").waitFor();
  assert.equal(store.get("homes", firstHome.id).version, firstHome.version);
  await card("Original home")
    .getByRole("button", { name: "Remove", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove home location", exact: true })
    .click();
  await card("Original home").waitFor({ state: "detached" });
  await page.getByRole("link", { name: "Our timeline", exact: true }).click();
  await page
    .getByRole("link", { name: "Trip from original home", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit visit", exact: true }).click();
  assert.equal(
    await page.getByLabel("Started from", { exact: true }).inputValue(),
    firstHome.id,
  );
  assert.match(
    await page
      .getByLabel("Started from", { exact: true })
      .locator("option:checked")
      .innerText(),
    /Original home.*removed/,
  );
  await page.getByRole("button", { name: "Save visit", exact: true }).click();
  await page.locator("dialog").waitFor({ state: "detached" });
  await page.getByRole("link", { name: "Workspace", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: join(tmpdir(), "everoutward-multiple-homes-mobile.png"),
  });
  await card("Family base")
    .getByRole("button", { name: "Remove", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("button", { name: "Remove home location", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const journal = publicJournal(
    catalogue,
    store.list("visits"),
    store.list("homes"),
    store.list("routes"),
    secondHome.id,
  );
  await page.route("**/api/session", (r) =>
    r.fulfill({
      json: { local: false, owner: false, passwordConfigured: true },
    }),
  );
  await page.route("**/data/history.json", (r) => r.fulfill({ json: journal }));
  await page.goto(origin);
  await page.getByRole("link", { name: "Our timeline", exact: true }).click();
  assert.equal(
    await page.getByRole("link", { name: "Workspace", exact: true }).count(),
    0,
  );
  await page.getByText("From Original home", { exact: true }).first().waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: add/edit/switch/remove homes, name-only home labels and numbered rank pins, unsaved home edits guarded, independent styled circles, non-current trip origin, archived-origin editing, mobile and public history.",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  store.close();
}

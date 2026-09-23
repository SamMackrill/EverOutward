import { createRequire } from "node:module";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import express from "express";
import { createStore } from "../server/store.mjs";
import { currentHome, routeKey } from "../server/homes.mjs";
import { createApp } from "../server/app.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const catalogue = JSON.parse(await readFile("public/data/places.json", "utf8"));
const store = createStore(":memory:");
const home = { lat: 52, lng: 0, label: "Test home", version: "test-home" };
for (let i = 0; i < 45; i++) {
  const id = `fixture-${String(i).padStart(3, "0")}`;
  store.put("visits", id, {
    id,
    placeId: catalogue.places[i].id,
    date: `2026-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
    title: `Browser memory ${i}`,
    summary: "A garden and a good walk.",
    notes: "Our full visit story.\nA second paragraph.",
    rating: 4,
    photos: [
      {
        id: "photo-1",
        url: "https://example.org/test-photo.png",
        caption: "At the gate",
        kind: "image",
      },
    ],
    coverId: "photo-1",
    published: true,
    createdAt: "2026-01-01T12:00:00Z",
    updatedAt: "2026-01-01T12:00:00Z",
  });
}
const app = createApp({
  store,
  places: catalogue.places,
  initialHome: home,
  enableCloud: false,
});
app.use(express.static(resolve("dist")));
app.get("/{*path}", (req, res) => res.sendFile(resolve("dist/index.html")));
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = `http://127.0.0.1:${server.address().port}`;
process.env.APP_ORIGIN = origin;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
// Avoid repeatedly downloading map tiles while exercising journal controls.
await page.route("**/tile.openstreetmap.org/**", (r) => r.abort());
await page.route("https://example.org/test-photo.png", (r) =>
  r.fulfill({
    contentType: "image/png",
    path: resolve("public/icons/gate-512.png"),
  }),
);
const screenshots = join(tmpdir(), "everoutward-browser-check");
await mkdir(screenshots, { recursive: true });
try {
  await page.goto(origin);
  await page.locator(".leaflet-baseLand-pane path:visible").first().waitFor();
  await page
    .getByText("Street detail is unavailable.", { exact: false })
    .waitFor();
  assert.equal(await page.locator(".leaflet-tile").count(), 0);
  await page.getByLabel("Map detail", { exact: true }).selectOption("overview");
  await page.getByLabel("Map detail", { exact: true }).selectOption("streets");
  await page
    .getByText("Street detail is unavailable.", { exact: false })
    .waitFor();
  assert.ok((await page.locator(".leaflet-baseLand-pane path").count()) > 0);
  assert.equal(await page.locator(".leaflet-tile").count(), 0);
  await page
    .getByRole("button", { name: "Dismiss map notice", exact: true })
    .click();
  await page.locator(".map-error").waitFor({ state: "detached" });
  await page.getByLabel("Map detail", { exact: true }).selectOption("overview");
  await page.locator(".map-error").waitFor({ state: "hidden" });
  await page.screenshot({ path: join(screenshots, "overview-map.png") });
  assert.match(
    await page.locator(".progress-strip").innerText(),
    new RegExp(`45 of ${catalogue.places.length} places · 45 days out`),
  );
  const wholeUk = page.getByRole("button", { name: "Whole UK", exact: true });
  assert.equal(await wholeUk.getAttribute("aria-pressed"), "false");
  await wholeUk.click();
  assert.equal(await wholeUk.getAttribute("aria-pressed"), "true");
  const toolbar = page.locator(".compact-toolbar");
  const toolbarHeight = await toolbar.evaluate((e) => e.offsetHeight);
  await page.getByRole("button", { name: "Find a place", exact: true }).click();
  assert.equal(
    await page.evaluate(() => document.activeElement?.ariaLabel),
    "Search National Trust places",
  );
  assert.equal(await toolbar.evaluate((e) => e.offsetHeight), toolbarHeight);
  await page.keyboard.type("Abbey");
  await page.locator(".search-results").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".search-results").waitFor({ state: "detached" });
  assert.equal(
    await page.evaluate(() => document.activeElement?.textContent),
    "Find a place",
  );
  await page.getByRole("button", { name: "Our timeline", exact: true }).click();
  await page.locator(".visit-card").first().waitFor();
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(120);
  }
  assert.equal(await page.locator(".visit-card").count(), 45);
  const before = await page.evaluate(() => scrollY);
  assert.ok(before > 1000, "the timeline scrolls with the page");
  await page
    .getByRole("button", { name: "Browser memory 0", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Browser memory 0", exact: true })
    .waitFor();
  assert.equal(
    await page.evaluate(() => scrollY),
    0,
    "a visit opened from a scrolled timeline starts at its top",
  );
  await page.getByLabel("Your name", { exact: true }).fill("Browser Guest");
  await page
    .getByLabel("Your comment", { exact: true })
    .fill("<script>plain text, not code</script>");
  await page.getByRole("button", { name: "Post comment", exact: true }).click();
  await page
    .getByText("Your comment has been posted.", { exact: false })
    .waitFor();
  assert.equal(await page.locator(".comment").count(), 1);
  await page
    .getByRole("button", { name: "View photo and comments: At the gate" })
    .click();
  assert.equal(await page.locator("dialog .comment").count(), 0);
  await page
    .locator("dialog")
    .getByLabel("Your name", { exact: true })
    .fill("Photo Guest");
  await page
    .locator("dialog")
    .getByLabel("Your comment", { exact: true })
    .fill("A photo comment");
  await page
    .locator("dialog")
    .getByRole("button", { name: "Post comment", exact: true })
    .click();
  await page.locator("dialog .comment").waitFor();
  await page.getByLabel("Close dialog").click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.locator(".timeline-view").waitFor({ state: "visible" });
  await page.waitForFunction((y) => Math.abs(scrollY - y) < 100, before);
  await page
    .getByRole("button", { name: "Owner sign-in", exact: true })
    .click();
  await page.getByLabel("Owner password").fill("browser-test-password");
  await page
    .getByRole("button", { name: "Create owner password", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Record a visit", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await page.getByRole("button", { name: "Find a place", exact: true }).click();
  await page.keyboard.type(catalogue.places[0].name);
  await page
    .locator(".search-results button")
    .filter({ hasText: catalogue.places[0].name })
    .first()
    .click();
  assert.match(
    await page.locator("dialog .visit-count").innerText(),
    /Visited once · last 1 Jan 2026/,
  );
  await page
    .getByRole("button", { name: "Record a visit here", exact: true })
    .click();
  await page.getByRole("heading", { name: "Record a visit" }).waitFor();
  assert.equal(await page.locator("dialog").count(), 1);
  assert.equal(
    await page.locator("dialog select[name=placeId]").inputValue(),
    catalogue.places[0].id,
  );
  await page.keyboard.press("Escape");
  await page.locator("dialog").waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Close search" }).click();
  await page
    .getByRole("button", { name: "Record a visit", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await page.locator("dialog").waitFor({ state: "detached" });
  await page
    .getByRole("button", { name: "Record a visit", exact: true })
    .click();
  await page
    .getByLabel("A title for the day", { exact: false })
    .fill("Unsaved draft");
  await page.keyboard.press("Escape");
  await page.getByRole("alertdialog").waitFor();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  assert.equal(
    await page.getByLabel("A title for the day", { exact: false }).inputValue(),
    "Unsaved draft",
  );
  await page.mouse.click(5, 5);
  await page.getByRole("alertdialog").waitFor();
  await page
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await page.locator("dialog").waitFor({ state: "detached" });
  await page
    .getByRole("button", { name: "Record a visit", exact: true })
    .click();
  await page
    .locator("dialog select[name=placeId]")
    .selectOption(catalogue.places[50].id);
  await page
    .getByLabel("A title for the day", { exact: false })
    .fill("Saved through browser");
  await page
    .getByLabel("The full story")
    .fill("A private draft created in the browser.");
  assert.equal(
    await page
      .getByLabel("Include in the public journal when published")
      .isChecked(),
    true,
  );
  await page
    .getByLabel("Include in the public journal when published")
    .uncheck();
  await page
    .getByLabel("Who came along?", { exact: false })
    .fill("Ana, Sam, Ele");
  await page.getByRole("button", { name: "Save visit", exact: true }).click();
  await page
    .getByText("Visit saved to your local journal.", { exact: false })
    .waitFor();
  await page.getByRole("button", { name: "Our timeline", exact: true }).click();
  await page.getByLabel("Search visit history", { exact: true }).fill("Ele");
  await page
    .getByRole("button", { name: "Saved through browser", exact: true })
    .waitFor();
  assert.equal(await page.locator(".visit-card").count(), 1);
  await page
    .getByRole("button", { name: "Saved through browser", exact: true })
    .click();
  assert.equal(await page.locator(".visit-attendees li").count(), 3);
  await page.getByRole("button", { name: "Edit visit", exact: true }).click();
  assert.equal(
    await page.getByLabel("Who came along?", { exact: false }).inputValue(),
    "Ana, Sam, Ele",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Our timeline", exact: true }).click();
  await page.getByLabel("Search visit history", { exact: true }).fill("");
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await page.getByRole("radio", { name: "Dark theme", exact: true }).check();
  await page.reload();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await page.getByRole("button", { name: "Our timeline", exact: true }).click();
  await page.screenshot({ path: join(screenshots, "timeline-dark.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({ path: join(screenshots, "timeline-mobile.png") });
  const tabs = page.getByRole("navigation", { name: "Main navigation" });
  assert.deepEqual(
    await tabs.evaluate((nav) => {
      const box = nav.getBoundingClientRect();
      return [getComputedStyle(nav).position, Math.round(box.bottom)];
    }),
    ["fixed", 844],
  );
  await tabs.getByRole("button", { name: "Map", exact: true }).click();
  await page.locator(".map-legend").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Map key", exact: true }).click();
  await page.locator(".map-legend").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Map key", exact: true }).click();
  await page.getByRole("button", { name: "Workspace", exact: true }).click();
  const driving = page.locator(".home-location-card").first();
  assert.equal(await driving.locator('input[type="file"]').count(), 0);
  let finishCalculation;
  const calculation = new Promise((resolve) => {
    finishCalculation = resolve;
  });
  await page.route("**/api/homes/*/routes/refresh", async (route) => {
    await calculation;
    for (const [index, place] of catalogue.places.entries())
      store.put("routes", routeKey(currentHome(store), place.id), {
        homeId: currentHome(store).id,
        placeId: place.id,
        metres: 1000 + index * 1000,
        seconds: 100 + index * 100,
        homeVersion: home.version,
        checkedAt: new Date().toISOString(),
        source: "Browser fixture",
      });
    await route.fulfill({
      json: {
        saved: catalogue.places.length,
        total: catalogue.places.length,
        remaining: 0,
      },
    });
  });
  await driving
    .getByRole("button", {
      name: "Calculate all distances for Test home",
      exact: true,
    })
    .click();
  await driving
    .getByRole("button", { name: "Working…", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Add home location", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Publish journal to here.now", exact: true })
      .isDisabled(),
    true,
  );
  finishCalculation();
  await driving
    .getByRole("button", { name: "All distances saved", exact: true })
    .waitFor();
  await page.reload();
  await driving
    .getByRole("button", { name: "All distances saved", exact: true })
    .waitFor();
  assert.equal(
    await driving
      .getByRole("button", { name: "All distances saved", exact: true })
      .isDisabled(),
    true,
  );
  assert.ok(
    (await driving.innerText()).includes(
      `${catalogue.places.length} of ${catalogue.places.length}`,
    ),
  );
  await driving.screenshot({
    path: join(screenshots, "driving-distances-mobile.png"),
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await driving.screenshot({
    path: join(screenshots, "driving-distances.png"),
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: bundled map, blocked-tile fallback, progress strip, pressed map view and dismissible notice, place visit count and Record a visit here, mobile tab bar and map key, place search focus and stable toolbar, unsaved-edit guard on Esc and backdrop, 45-entry infinite history, back position, visit/photo guest comments, owner signup, draft save, theme persistence, mobile overflow, all-distance calculation busy state and saved totals after reload, no browser exceptions.",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  store.close();
}

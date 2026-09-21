import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import express from "express";
import { createApp } from "../server/app.mjs";
import { createStore } from "../server/store.mjs";

const catalogue = JSON.parse(await readFile("public/data/places.json", "utf8"));
const store = createStore(":memory:");
const photos = ["landscape", "portrait", "garden"].map((id) => ({
  id,
  url: `https://carousel.test/${id}.jpg`,
  caption: id,
  kind: "image",
}));
const base = {
  placeId: catalogue.places[0].id,
  date: "2026-09-10",
  title: "Wheel of memories",
  summary: "A day together",
  notes: "",
  attendees: [],
  rating: null,
  photos,
  coverId: "portrait",
  published: true,
  createdAt: "2026-09-10T12:00:00Z",
  updatedAt: "2026-09-10T12:00:00Z",
};
for (const [id, data] of Object.entries({
  wheel: base,
  one: { ...base, photos: [photos[1]] },
  empty: { ...base, photos: [] },
  broken: {
    ...base,
    photos: [
      photos[1],
      { ...photos[0], url: "https://carousel.test/broken.jpg" },
    ],
  },
}))
  store.put("visits", id, { ...data, id });
const app = createApp({ store, places: catalogue.places, enableCloud: false });
app.use(express.static(resolve("dist")));
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1200, height: 1000 },
  hasTouch: true,
});
await context.route("**/tile.openstreetmap.org/**", (r) => r.abort());
await context.route("https://carousel.test/**", (r) => {
  if (r.request().url().includes("broken")) return r.fulfill({ status: 404 });
  if (r.request().url().includes("portrait"))
    return r.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="800"><rect width="400" height="800" fill="#264f37"/><rect x="12" y="12" width="376" height="776" fill="none" stroke="#9bccad" stroke-width="16"/><text x="200" y="65" text-anchor="middle" fill="white" font-size="28">Portrait top edge</text><text x="200" y="755" text-anchor="middle" fill="white" font-size="28">Portrait bottom edge</text></svg>',
    });
  return r.fulfill({
    contentType: "image/jpeg",
    path: resolve(
      r.request().url().includes("garden")
        ? "public/photos/ickworth.jpg"
        : "public/photos/ramsey.jpg",
    ),
  });
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const current = () => page.locator(".carousel-slide.is-active img");
try {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.goto(`${origin}/#visit/wheel`);
  await current().evaluate((img) => img.decode());
  assert.equal(await current().getAttribute("alt"), "portrait");
  assert.equal(
    await current().evaluate((img) => getComputedStyle(img).objectFit),
    "contain",
  );
  assert.equal(
    await page.locator(".carousel-slide:not(.is-active)").count(),
    2,
  );
  await page.clock.runFor(9999);
  assert.equal(await current().getAttribute("alt"), "portrait");
  await page.clock.runFor(1);
  assert.equal(await current().getAttribute("alt"), "garden");
  await page.getByRole("button", { name: "Pause slideshow" }).click();
  await page.clock.runFor(20000);
  assert.equal(await current().getAttribute("alt"), "garden");
  await page.getByRole("button", { name: "Next photo", exact: true }).click();
  assert.equal(await current().getAttribute("alt"), "landscape");
  await page
    .getByRole("button", { name: "Previous photo", exact: true })
    .click();
  assert.equal(await current().getAttribute("alt"), "garden");
  await page.getByRole("button", { name: "Play slideshow" }).click();
  await page.clock.runFor(10000);
  assert.equal(await current().getAttribute("alt"), "landscape");
  // Mouse drag advances and pauses, without opening the lightbox.
  const wheel = page.locator(".carousel-wheel");
  await wheel.scrollIntoViewIfNeeded();
  const box = await wheel.boundingBox();
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 110, y, { steps: 8 });
  await page.mouse.up();
  assert.equal(await current().getAttribute("alt"), "portrait");
  assert.equal(await page.locator("dialog").count(), 0);
  await page.getByRole("button", { name: "Play slideshow" }).waitFor();
  await page.clock.runFor(1000);
  await page.mouse.move(x, y);
  await page.mouse.wheel(-100, 0);
  await page.waitForFunction(
    () =>
      document.querySelector(".carousel-slide.is-active img")?.alt ===
      "landscape",
  );
  // Touchscreen input exercises real browser pointer capture and pan-y behaviour.
  await page.setViewportSize({ width: 390, height: 844 });
  await wheel.scrollIntoViewIfNeeded();
  const mobile = await wheel.boundingBox();
  const client = await context.newCDPSession(page);
  const sx = mobile.x + mobile.width * 0.7,
    sy = mobile.y + mobile.height / 2;
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: sx, y: sy }],
  });
  for (let dx = 15; dx <= 120; dx += 15)
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: sx - dx, y: sy }],
    });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  assert.equal(await current().getAttribute("alt"), "portrait");
  assert.equal(await page.locator("dialog").count(), 0);
  await page.clock.runFor(1000);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: resolve(tmpdir(), "everoutward-carousel-mobile.png"),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1200, height: 1000 });
  await page.screenshot({
    path: resolve(tmpdir(), "everoutward-carousel-desktop.png"),
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Open photo: portrait", exact: true })
    .click();
  await page.getByRole("dialog").waitFor();
  await page.getByLabel("Close dialog").click();
  await page.getByRole("button", { name: "Our timeline", exact: true }).click();
  const card = page.locator(".visit-card").filter({
    has: page.locator('img[src="https://carousel.test/landscape.jpg"]'),
  });
  assert.ok((await card.count()) >= 1);
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await page.goto(`${origin}/#visit/wheel`);
  await page.getByRole("button", { name: "Play slideshow" }).waitFor();
  await page.clock.runFor(20000);
  assert.equal(await current().getAttribute("alt"), "portrait");
  assert.equal(
    await current().evaluate(
      (img) =>
        getComputedStyle(img.closest(".carousel-slide")).transitionDuration,
    ),
    "0s",
  );
  await page.screenshot({
    path: resolve(tmpdir(), "everoutward-carousel-dark.png"),
  });
  for (const id of ["one", "broken"]) {
    await page.goto(`${origin}/#visit/${id}`);
    await current().evaluate((img) => img.decode());
    await page.waitForFunction(
      () => document.querySelector('button[aria-label="Next photo"]')?.disabled,
    );
    assert.equal(
      await page.getByRole("button", { name: "Play slideshow" }).isDisabled(),
      true,
    );
  }
  await page.goto(`${origin}/#visit/empty`);
  await page
    .getByRole("heading", { name: "Photos from this visit", exact: true })
    .waitFor();
  assert.equal(await page.locator(".visit-carousel").count(), 0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(`${origin}/#visit/wheel`);
  const interval = page.getByRole("combobox", { name: "Slideshow interval" });
  await interval.waitFor();
  assert.equal(await interval.inputValue(), "10");
  assert.equal(await interval.locator("option").count(), 20);
  await interval.selectOption("1");
  await page.clock.runFor(999);
  assert.equal(await current().getAttribute("alt"), "portrait");
  await page.clock.runFor(1);
  assert.equal(await current().getAttribute("alt"), "garden");
  await interval.selectOption("20");
  await page.clock.runFor(19999);
  assert.equal(await current().getAttribute("alt"), "garden");
  await page.clock.runFor(1);
  assert.equal(await current().getAttribute("alt"), "landscape");
  await page.reload();
  await interval.waitFor();
  assert.equal(await interval.inputValue(), "20");
  await page.getByRole("button", { name: "Our timeline", exact: true }).click();
  await page.goto(`${origin}/#visit/one`);
  await interval.waitFor();
  assert.equal(await interval.inputValue(), "20");
  // Select keyboard input must not trigger carousel navigation or pause playback.
  await page.goto(`${origin}/#visit/wheel`);
  await interval.focus();
  await interval.press("ArrowLeft");
  assert.equal(await current().getAttribute("alt"), "portrait");
  await page.getByRole("button", { name: "Pause slideshow" }).waitFor();
  // Invalid saved values safely return to the default.
  await page.evaluate(() => localStorage.setItem("eo-carousel-seconds", "99"));
  await page.reload();
  await interval.waitFor();
  assert.equal(await interval.inputValue(), "10");
  // A browser that denies storage can still change speed and navigate visits.
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error("Storage denied");
    };
    Storage.prototype.setItem = () => {
      throw new Error("Storage denied");
    };
  });
  await page.reload();
  await interval.selectOption("3");
  await page.clock.runFor(3000);
  assert.equal(await current().getAttribute("alt"), "garden");
  await page.getByRole("button", { name: "Our timeline", exact: true }).click();
  await page.goto(`${origin}/#visit/wheel`);
  await interval.waitFor();
  assert.equal(await interval.inputValue(), "3");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: portrait fit, cover-first carousel, first-photo timeline, autoplay, pause/play, arrows, mouse/trackpad/touch, mobile, reduced motion, missing photos; 1–20s intervals, refresh/visit persistence, select keyboard behaviour and denied-storage fallback.",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  store.close();
}

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
const app = createApp({
  store,
  places: catalogue.places,
  enableCloud: false,
  localOwner: true,
});
app.use(express.static(resolve("dist")));
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = `http://127.0.0.1:${server.address().port}`;
process.env.APP_ORIGIN = origin;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.route("**/tile.openstreetmap.org/**", (r) => r.abort());
// A deterministic unavailable-provider response exercises the user fallback.
await page.route("**/api/photo-links/preview", (r) =>
  r.fulfill({
    json: { previewUrl: "", message: "Choose a display photo below." },
  }),
);
const image = (await readFile("public/photos/ramsey.jpg")).toString("base64");
async function dropImage(locator) {
  const transfer = await page.evaluateHandle((base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "gate.jpg", { type: "image/jpeg" }));
    return transfer;
  }, image);
  await locator.dispatchEvent("drop", { dataTransfer: transfer });
  await transfer.dispose();
}
try {
  await page.goto(origin);
  await page.getByRole("button", { name: "Workspace", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Owner sign-in" }).count(),
    0,
  );
  assert.equal(await page.getByRole("button", { name: "Sign out" }).count(), 0);
  assert.equal((await page.context().cookies()).length, 0);
  await page
    .getByRole("button", { name: "Record a visit", exact: true })
    .click();
  await page
    .locator("dialog select[name=placeId]")
    .selectOption(catalogue.places[0].id);
  await page
    .getByLabel("A title for the day", { exact: false })
    .fill("Linked photo visit");
  await page.getByLabel("Include in the public journal").check();
  const transfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.setData("text/uri-list", "https://photos.app.goo.gl/example");
    return transfer;
  });
  await page
    .locator(".photo-drop-zone")
    .dispatchEvent("drop", { dataTransfer: transfer });
  await transfer.dispose();
  assert.equal(
    await page.getByLabel("Photo 1 link", { exact: true }).inputValue(),
    "https://photos.app.goo.gl/example",
  );
  await page
    .getByLabel("Photo 1 link", { exact: true })
    .fill("https://photos.google.com/photo/private-example");
  await page
    .getByText("This is a Google Photos library link.", { exact: false })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Load preview", exact: true })
      .isDisabled(),
    true,
  );
  await page
    .getByLabel("Photo 1 link", { exact: true })
    .fill("https://photos.app.goo.gl/example");
  await page
    .getByText("Choose a display photo below.", { exact: true })
    .waitFor();
  await dropImage(page.locator(".photo-editor").first());
  await page.locator(".photo-link-preview").first().waitFor();
  await page.getByLabel("Visit cover", { exact: true }).check();
  await dropImage(page.locator(".photo-drop-zone"));
  await page.locator(".photo-editor").nth(1).waitFor();
  assert.equal(
    await page.getByLabel("Photo 2 link", { exact: true }).inputValue(),
    "",
  );
  await page.locator(".photo-drop-zone").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: resolve(tmpdir(), "everoutward-photo-editor.png"),
  });
  await page.getByRole("button", { name: "Save visit", exact: true }).click();
  await page
    .getByText("Visit saved to your local journal.", { exact: false })
    .waitFor();
  const visit = store.list("visits")[0];
  assert.equal(visit.photos.length, 2);
  assert.equal(visit.coverId, visit.photos[0].id);
  assert.equal(visit.photos[0].url, "https://photos.app.goo.gl/example");
  assert.match(visit.photos[0].previewUrl, /^data:image\/jpeg;base64,/);
  await page.getByRole("button", { name: "Our timeline", exact: true }).click();
  await page.locator(".visit-card img").evaluate((img) => img.decode());
  await page
    .getByRole("button", { name: "Linked photo visit", exact: true })
    .click();
  await page
    .locator(".carousel-slide.is-active img")
    .evaluate((img) => img.decode());
  assert.equal(await page.locator(".photo-gallery img").count(), 2);
  await page.screenshot({
    path: resolve(tmpdir(), "everoutward-photo-detail.png"),
  });
  await page
    .getByRole("button", {
      name: "View photo and comments: Visit photo",
      exact: true,
    })
    .first()
    .click();
  assert.equal(
    await page
      .getByRole("link", { name: "Open in Google Photos" })
      .getAttribute("href"),
    visit.photos[0].url,
  );
  await page.getByLabel("Close dialog").click();
  await page.getByRole("button", { name: "Edit visit", exact: true }).click();
  assert.equal(
    await page.getByLabel("Visit cover", { exact: true }).first().isChecked(),
    true,
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Add photos", exact: true }).click();
  await page
    .getByRole("heading", { name: "Photo links", exact: true })
    .waitFor();
  assert.ok(await page.locator("dialog").evaluate((el) => el.scrollTop > 0));
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.context().clearCookies();
  await page.goto(`${origin}/?addPhotos=${visit.id}#visit/${visit.id}`);
  await page
    .getByRole("heading", { name: "Photo links", exact: true })
    .waitFor();
  assert.ok(await page.locator("dialog").evaluate((el) => el.scrollTop > 0));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/photo-links/album", (r) =>
    r.fulfill({
      json: {
        message: "Review the photos before adding.",
        photos: [1, 2, 3].map((n) => ({
          sourceId: `AF1Qtest${n}`,
          url: `https://photos.google.com/share/test/photo/AF1Qtest${n}?key=example`,
          kind: "shared",
          caption: "",
          previewUrl: `https://album-test.example/${n}.jpg`,
        })),
      },
    }),
  );
  await page.route("https://album-test.example/**", (r) =>
    r.fulfill({
      contentType: "image/jpeg",
      body: Buffer.from(image, "base64"),
    }),
  );
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText: async () => "https://photos.app.goo.gl/test-album" },
    }),
  );
  const album = page.getByRole("region", {
    name: "Import a Google Photos album",
  });
  await album.getByRole("button", { name: "Paste link", exact: true }).click();
  assert.equal(
    await page.getByLabel("Google Photos album link").inputValue(),
    "https://photos.app.goo.gl/test-album",
  );
  await album.getByRole("button", { name: "Load album", exact: true }).click();
  await album.getByLabel("Keep photo 2", { exact: true }).uncheck();
  await album
    .getByRole("button", { name: "Add selected photos (2)", exact: true })
    .click();
  assert.equal(await page.locator(".photo-editor").count(), 4);
  assert.equal(
    await album.getByLabel("Photo 1 · already added").isDisabled(),
    true,
  );
  await page
    .locator(".photo-editor")
    .nth(3)
    .getByRole("button", { name: "Remove", exact: true })
    .click();
  await page
    .locator(".photo-editor")
    .nth(2)
    .getByLabel("Visit cover", { exact: true })
    .check();
  // Clipboard-denied fallback focuses the right field and gives an actionable shortcut.
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: async () => {
          throw Error("denied");
        },
      },
    }),
  );
  await album.getByRole("button", { name: "Paste link", exact: true }).click();
  assert.equal(
    await page
      .getByLabel("Google Photos album link")
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await album
    .getByText("The link field is selected", { exact: false })
    .waitFor();
  // Per-photo paste replaces the intended link, then its preview can be loaded normally.
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText: async () => "https://photos.app.goo.gl/example" },
    }),
  );
  await page
    .locator(".photo-editor")
    .first()
    .getByRole("button", { name: "Paste link", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("Photo 1 link", { exact: true }).inputValue(),
    "https://photos.app.goo.gl/example",
  );
  await dropImage(page.locator(".photo-editor").first());
  await page.locator(".photo-link-preview").first().waitFor();
  await page.getByRole("button", { name: "Save visit", exact: true }).click();
  await page
    .getByText("Visit saved to your local journal.", { exact: false })
    .waitFor();
  const albumVisit = store.list("visits")[0];
  assert.equal(albumVisit.photos.length, 3);
  assert.equal(albumVisit.coverId, albumVisit.photos[2].id);
  assert.match(albumVisit.photos[2].url, /AF1Qtest1/);
  assert.equal(
    albumVisit.photos.some((p) => /AF1Qtest[23]/.test(p.url)),
    false,
  );
  await page.getByRole("button", { name: "Add photos", exact: true }).click();
  await page
    .getByLabel("Google Photos album link")
    .fill("https://photos.app.goo.gl/test-album");
  await album.getByRole("button", { name: "Load album", exact: true }).click();
  await album.getByLabel("Photo 1 · already added").waitFor();
  assert.equal(
    await album.getByLabel("Photo 1 · already added").isDisabled(),
    true,
  );
  await album.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: resolve(tmpdir(), "everoutward-album-import.png"),
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.route("**/api/session", (route) =>
    route.fulfill({
      json: { local: false, owner: false, passwordConfigured: true },
    }),
  );
  await page.route("**/data/history.json", (route) =>
    route.fulfill({
      json: { visits: [{ ...visit, photos: [], coverId: null }], queue: [] },
    }),
  );
  await page.goto(`${origin}/?publicTest=1#visit/${visit.id}`);
  await page.getByRole("button", { name: "Add photos", exact: true }).click();
  const ownerLink = new URL(
    await page
      .getByRole("link", { name: "Open this visit in owner workspace" })
      .getAttribute("href"),
  );
  assert.equal(ownerLink.searchParams.get("addPhotos"), visit.id);
  assert.equal(ownerLink.hash, `#visit/${visit.id}`);
  assert.equal(ownerLink.origin, "http://127.0.0.1:3001");
  console.log(
    "PASS: local editing and photo deep links without login or cookies, drop Google link, unavailable preview fallback, drop display photo onto link, select cover, drop standalone image, save/reopen, gallery and timeline render, provider link preserved, mobile layout.",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  store.close();
}

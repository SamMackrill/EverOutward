import { chromium } from "playwright";
import assert from "node:assert/strict";
import express from "express";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { createStore } from "../server/store.mjs";
import { createApp } from "../server/app.mjs";
import { createPublishJobs, runPublishJob } from "../server/publish-jobs.mjs";
import { publishedVisitHash } from "../server/publish-journal.mjs";
import { currentHome, originFor } from "../server/homes.mjs";

const { places } = JSON.parse(
  await readFile("public/data/places.json", "utf8"),
);
const store = createStore(":memory:");
let release,
  work,
  shouldFail = true,
  launches = 0;
const publisher = createPublishJobs({
  store,
  launch(job) {
    launches++;
    const barrier = new Promise((r) => (release = r));
    work = runPublishJob(store, job.id, async (progress) => {
      progress("Uploading website files…");
      await barrier;
      if (shouldFail)
        throw new Error(
          "The upload connection was interrupted. Retry publishing.",
        );
      store.put("settings", "lastPublication", {
        visits: Object.fromEntries(
          store
            .list("visits")
            .filter((v) => v.published)
            .map((v) => [v.id, publishedVisitHash(v, store.list("homes"))]),
        ),
      });
      return {
        siteUrl: "https://example.here.now/",
        publishedAt: new Date().toISOString(),
        publishedVisitCount: store.list("visits").filter((v) => v.published)
          .length,
      };
    });
  },
});
const app = createApp({
  store,
  places,
  publisher,
  localOwner: true,
  enableCloud: false,
  initialHome: { label: "CB3 0LL", lat: 52, lng: 0, version: "one" },
});
const home = currentHome(store);
const baseVisit = {
  placeId: places[0].id,
  date: "2026-09-10",
  notes: "",
  summary: "",
  photos: [],
  attendees: [],
  coverId: null,
  rating: 4,
  createdAt: "created",
  updatedAt: "updated",
  ...originFor(home),
};
store.put("visits", "excluded", {
  ...baseVisit,
  id: "excluded",
  title: "My Fair Lady",
  published: false,
});
store.put("visits", "included", {
  ...baseVisit,
  id: "included",
  title: "The Wind in the Willows",
  published: true,
});
store.put("homes", home.id, { ...home, label: "Girton" });
app.use(express.static(resolve("dist")));
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = `http://127.0.0.1:${server.address().port}`;
process.env.APP_ORIGIN = origin;
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.route("**/tile.openstreetmap.org/**", (r) => r.abort());
try {
  // Timeline cards only mention the origin when it isn't the current home.
  await page.goto(origin + "/#visit/included");
  await page.getByText("From Girton", { exact: true }).waitFor();
  await page.goto(origin + "/#timeline");
  await page.locator(".visit-card").first().waitFor();
  assert.equal(await page.getByText("From Girton").count(), 0);
  assert.match(
    await page
      .locator(".visit-card")
      .filter({ hasText: "My Fair Lady" })
      .innerText(),
    /Only on this computer/i,
  );
  await page.getByRole("link", { name: "Workspace", exact: true }).click();
  await page
    .getByText("1 visits included · 1 excluded from publishing.", {
      exact: true,
    })
    .waitFor();
  await page.getByText("Choose visits to publish", { exact: true }).click();
  await page
    .getByRole("checkbox", {
      name: "Include My Fair Lady in next publish",
      exact: true,
    })
    .check();
  await page
    .getByText("2 visits included · 0 excluded from publishing.", {
      exact: true,
    })
    .waitFor();
  await page
    .getByRole("button", { name: "Publish journal to here.now", exact: true })
    .click();
  await page.getByText("Uploading website files…", { exact: false }).waitFor();
  await page.reload();
  await page
    .getByRole("button", { name: "Publishing…", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Publishing…", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(launches, 1);
  release();
  await work;
  await page
    .getByRole("alert")
    .filter({ hasText: "upload connection was interrupted" })
    .waitFor();
  await page.reload();
  await page
    .getByRole("alert")
    .filter({ hasText: "upload connection was interrupted" })
    .waitFor();
  shouldFail = false;
  await page
    .getByRole("button", { name: "Publish journal to here.now", exact: true })
    .click();
  await page.getByText("Uploading website files…", { exact: false }).waitFor();
  release();
  await work;
  await page
    .getByText("2 visits published successfully.", { exact: true })
    .waitFor();
  await page.getByRole("link", { name: "Our timeline", exact: true }).click();
  assert.match(
    await page
      .locator(".visit-card")
      .filter({ hasText: "My Fair Lady" })
      .innerText(),
    /Published/i,
  );
  await page
    .getByRole("button", { name: "Record a visit", exact: true })
    .click();
  assert.equal(
    await page
      .getByLabel("Include in the public journal when published")
      .isChecked(),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: publication selection, included-by-default visits, renamed home labels, persistent progress across refresh, visible failure, retry, and confirmed live statuses.",
  );
} finally {
  release?.();
  await work;
  await browser.close();
  await new Promise((r) => server.close(r));
  store.close();
}

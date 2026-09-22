import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../server/store.mjs";
import { createApp } from "../server/app.mjs";
import { currentHome, routeKey, publicJournal } from "../server/homes.mjs";
import {
  applyPlaceCorrections,
  distanceReviewRows,
  publicPlaceOverrides,
  saveReviewedRoute,
} from "../server/distance-review.mjs";
import { wazeLink, outward } from "../server/domain.mjs";
import { refreshDrivingRoutes } from "../server/routing.mjs";
import { journalSnapshot } from "../server/publish-journal.mjs";
import { createPublishJobs, runPublishJob } from "../server/publish-jobs.mjs";

const places = Array.from({ length: 8 }, (_, i) => ({
  id: String(i),
  name: `Place ${i}`,
  lat: 52 + i / 100,
  lng: 0,
}));
test("review resolves one home, corrects entrances for every home, retains unrelated routes and publishes safe corrections", async (t) => {
  const store = createStore(":memory:");
  let queued = 0;
  const calls = [];
  const app = createApp({
    store,
    places,
    initialHome: { label: "Home A", lat: 52, lng: 0, version: "one" },
    localOwner: true,
    enableCloud: false,
    autoPublish: true,
    publisher: {
      status: () => null,
      enqueue: () => {
        queued++;
        return { id: "queued", status: "running" };
      },
    },
    routeFetcher: async (url) => {
      calls.push(url);
      return {
        ok: true,
        json: async () => ({
          code: "Ok",
          sources: [{ distance: 0 }],
          destinations: [{ distance: 0 }, { distance: 10 }],
          distances: [[0, 12000]],
          durations: [[0, 900]],
        }),
      };
    },
  });
  const a = currentHome(store),
    b = { ...a, id: "b", label: "Home B", lat: 53 };
  store.put("homes", b.id, b);
  for (const h of [a, b]) {
    for (const p of places.slice(1))
      store.put("routes", routeKey(h, p.id), {
        homeId: h.id,
        homeVersion: h.version,
        placeId: p.id,
        metres: 15000 + Number(p.id) * 1000,
        seconds: 900,
      });
    store.put("routeReports", JSON.stringify([h.id, h.version]), {
      homeId: h.id,
      homeVersion: h.version,
      unavailablePlaces: [
        {
          placeId: "0",
          name: "Place 0",
          reason: "Catalogue point too far from a road",
        },
      ],
    });
  }
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => {
    server.close();
    store.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, method = "GET", body) => {
    const r = await fetch(base + path, {
      method,
      headers: {
        Origin: "http://127.0.0.1:5173",
        "X-EverOutward": "1",
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, data: await r.json() };
  };
  const row = (h, id) =>
    distanceReviewRows(
      store,
      h,
      applyPlaceCorrections(places, store.list("placeCorrections")),
    ).find((r) => r.placeId === id);
  const correct = async (h, id, data) =>
    request(`/api/distance-review/${id}`, "POST", {
      homeId: h.id,
      homeVersion: h.version,
      revision: row(h, id).revision,
      ...data,
    });
  assert.equal(row(a, "0").status, "needs-review");
  const stale = row(a, "0").revision;
  const manual = await correct(a, "0", {
    action: "manual",
    metres: 90000,
    seconds: 3600,
    source: "Verified Waze route",
    note: "Private evidence",
  });
  assert.equal(manual.status, 200);
  assert.equal(queued, 1);
  assert.equal(row(a, "0").status, "resolved");
  assert.equal(row(b, "0").status, "needs-review");
  assert.equal(
    (
      await request("/api/distance-review/0", "POST", {
        homeId: a.id,
        homeVersion: a.version,
        revision: stale,
        action: "manual",
        metres: 10000,
        seconds: 1000,
        source: "Waze",
      })
    ).status,
    409,
  );
  let published = publicJournal(places, [], [a, b], store.list("routes"), a.id);
  assert(!published.queue.some((r) => r.placeId === "0"));
  assert.equal(
    published.homes[0].reviewedRoutes.find((r) => r.placeId === "0").metres,
    90000,
  );
  assert(!JSON.stringify(published).includes("Private evidence"));
  await correct(a, "0", { action: "flag", reason: "Wrong car park" });
  assert.equal(row(a, "0").status, "needs-review");
  assert(
    !publicJournal(places, [], [a, b], store.list("routes"), a.id).homes[0]
      .reviewedRoutes.length,
  );
  const unrelated = store.get("routes", routeKey(a, "1"));
  const entrance = await correct(a, "0", {
    action: "entrance",
    entrance: { lat: 52.025, lng: 0.02 },
    sourceUrl: "https://www.nationaltrust.org.uk/visit/visitor-information",
    publicNote: "Park at the road entrance, then walk.",
    note: "Private entrance evidence",
  });
  assert.equal(entrance.status, 200);
  assert.equal(entrance.data.outcomes.length, 2);
  assert(entrance.data.outcomes.every((o) => o.resolved));
  assert.equal(calls.length, 2);
  assert(calls.every((url) => url.includes("0.02,52.025")));
  assert.equal(row(a, "0").status, "resolved");
  assert.equal(row(b, "0").status, "resolved");
  assert.deepEqual(store.get("routes", routeKey(a, "1")), unrelated);
  const corrected = applyPlaceCorrections(
    places,
    store.list("placeCorrections"),
  );
  assert.equal(
    corrected[0].lat,
    places[0].lat,
    "catalogue discovery point remains intact",
  );
  assert(wazeLink(corrected[0]).includes("52.025,0.02"));
  published = publicJournal(corrected, [], [a, b], store.list("routes"), a.id);
  published.placeOverrides = publicPlaceOverrides(
    store.list("placeCorrections"),
  );
  assert(published.homes.every((h) => h.reviewedRoutes[0].metres === 12000));
  for (const field of [
    "Private entrance evidence",
    "sourceUrl",
    "homeVersion",
    "destinationVersion",
  ])
    assert(!JSON.stringify(published).includes(field));
  assert(JSON.stringify(published).includes("Park at the road entrance"));
  assert.equal(
    (await request("/api/state")).data.placeOverrides[0].entrance.lat,
    52.025,
  );
  const before = journalSnapshot(store).fingerprint;
  const correction = store.get("placeCorrections", "0");
  store.put("placeCorrections", "0", {
    ...correction,
    version: "changed",
    entrance: { lat: 52.03, lng: 0.03 },
  });
  assert.notEqual(journalSnapshot(store).fingerprint, before);
  assert.equal(row(a, "0").status, "needs-review");
  assert(
    !outward(
      applyPlaceCorrections(places, store.list("placeCorrections")),
      [],
      a,
      store.list("routes"),
    ).ranked.some((r) => r.placeId === "0"),
  );
  assert.equal(queued, 3);
});

test("targeted retries preserve other failure reports and reject an entrance changed during a request", async () => {
  const store = createStore(":memory:");
  createApp({
    store,
    places,
    initialHome: { label: "Home", lat: 52, lng: 0, version: "one" },
    enableCloud: false,
  });
  const home = currentHome(store);
  store.put("routeReports", JSON.stringify([home.id, home.version]), {
    unavailablePlaces: [
      { placeId: "0", reason: "Failed" },
      { placeId: "1", reason: "Still needs review" },
    ],
  });
  const options = {
    store,
    places,
    homeId: home.id,
    onlyPlaceIds: ["0"],
    force: true,
    reviewed: true,
    wait: async () => {},
    fetcher: async () => ({
      ok: true,
      json: async () => ({
        code: "Ok",
        sources: [{ distance: 0 }],
        destinations: [{ distance: 0 }, { distance: 0 }],
        distances: [[0, 10000]],
        durations: [[0, 500]],
      }),
    }),
  };
  try {
    const result = await refreshDrivingRoutes(options);
    assert.equal(result.total, 8);
    assert.equal(result.saved, 1);
    assert.deepEqual(
      result.unavailablePlaces.map((p) => p.placeId),
      ["1"],
    );
    const before = store.get("routes", routeKey(home, "0"));
    await assert.rejects(
      refreshDrivingRoutes({
        ...options,
        fetcher: async () => {
          store.put("placeCorrections", "0", {
            placeId: "0",
            version: "new",
            entrance: { lat: 52.02, lng: 0.02 },
          });
          return options.fetcher();
        },
      }),
      /entrance changed/,
    );
    assert.deepEqual(store.get("routes", routeKey(home, "0")), before);
  } finally {
    store.close();
  }
});

test("a correction during publication queues a follow-up instead of disappearing into the running job", async () => {
  const store = createStore(":memory:");
  let launches = 0;
  const jobs = createPublishJobs({ store, launch: () => launches++ });
  try {
    const first = jobs.start();
    assert.equal(jobs.enqueue().id, first.id);
    assert.equal(store.get("settings", "publishRequested").value, true);
    assert.equal(launches, 1);
    await runPublishJob(store, first.id, async () => {
      throw new Error("Journal changed");
    });
    const next = jobs.start();
    assert.notEqual(next.id, first.id);
    assert.equal(launches, 2);
    assert.equal(store.get("settings", "publishRequested"), null);
  } finally {
    store.close();
  }
});

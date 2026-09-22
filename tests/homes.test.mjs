import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../server/store.mjs";
import { createApp } from "../server/app.mjs";
import {
  currentHome,
  homeRoutes,
  migrateHomes,
  originFor,
  routeKey,
  publicJournal,
} from "../server/homes.mjs";
import { refreshDrivingRoutes } from "../server/routing.mjs";
import {
  journalSnapshot,
  assertJournalUnchanged,
} from "../server/publish-journal.mjs";
import { haversine } from "../server/domain.mjs";

const initial = {
  label: "CB3 0LL",
  lat: 52.011,
  lng: 0.017,
  version: "original",
};
const places = Array.from({ length: 7 }, (_, i) => ({
  id: String(i),
  name: `Place ${i}`,
  lat: 52.02 + i / 100,
  lng: 0.02,
}));
const visitData = {
  placeId: "0",
  date: "2026-09-01",
  title: "A memory",
  summary: "",
  notes: "Keep every word.",
  attendees: ["Ana"],
  photos: [
    {
      id: "cover",
      url: "https://example.org/cover.jpg",
      kind: "image",
      caption: "Our cover",
    },
  ],
  coverId: "cover",
  published: true,
  rating: 5,
};

test("migration backs up, preserves visits and route values, assigns all origins once, and quarantines old routes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "eo-homes-")),
    path = join(dir, "journal.sqlite");
  const store = createStore(path);
  const before = {
    ...visitData,
    id: "visit-1",
    createdAt: "old",
    updatedAt: "old",
  };
  store.put("settings", "home", initial);
  store.put("visits", before.id, before);
  store.put("visits", "draft", { ...before, id: "draft", published: false });
  store.put("comments", "comment", { body: "Retain this comment" });
  store.put("routes", "0", {
    placeId: "0",
    homeVersion: initial.version,
    metres: 1234,
    seconds: 432,
    checkedAt: "old",
    source: "manual",
  });
  store.put("routes", "1", {
    placeId: "1",
    homeVersion: "unknown",
    metres: 9999,
  });
  try {
    migrateHomes(store);
    const home = currentHome(store);
    assert.equal(home.label, "CB3 0LL");
    assert.equal(home.version, initial.version);
    const migrated = store.get("visits", before.id);
    const {
      startingHomeId,
      startingHomeVersion,
      startingHomeSnapshot,
      ...unchanged
    } = migrated;
    assert.deepEqual(unchanged, before);
    assert.deepEqual(
      startingHomeSnapshot,
      originFor(home).startingHomeSnapshot,
    );
    assert.equal(startingHomeId, home.id);
    assert.equal(startingHomeVersion, initial.version);
    assert.equal(store.get("visits", "draft").startingHomeId, home.id);
    assert.equal(store.list("routes").length, 1);
    assert.equal(homeRoutes(store, home)[0].metres, 1234);
    assert.equal(store.list("legacyRoutes").length, 1);
    assert.equal(store.get("settings", "home"), null);
    const backups = await readdir(join(dir, "backups"));
    assert.equal(backups.length, 1);
    const backup = createStore(join(dir, "backups", backups[0]));
    assert.deepEqual(backup.get("visits", before.id), before);
    backup.close();
    store.put("visits", before.id, {
      ...migrated,
      startingHomeId: "deliberate-correction",
    });
    const after = store.snapshot();
    migrateHomes(store);
    assert.deepEqual(store.snapshot(), after);
    const snapshot = journalSnapshot(store);
    store.put("homes", home.id, { ...home, label: "Renamed" });
    assert.throws(
      () => assertJournalUnchanged(path, snapshot.fingerprint),
      /journal changed/,
    );
  } finally {
    store.close();
  }
});

test("home API isolates distances, preserves historical origins and atomically replaces removed current homes", async (t) => {
  const store = createStore(":memory:");
  const app = createApp({
    store,
    places,
    initialHome: initial,
    localOwner: true,
    enableCloud: false,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => {
    server.close();
    store.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, method = "GET", body) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:5173",
        "X-EverOutward": "1",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };
  const a = currentHome(store);
  const add = await call("/api/homes", "POST", {
    label: "Coast",
    colour: "#3569a0",
    lat: 52.05,
    lng: 0.03,
  });
  assert.equal(add.status, 201);
  const b = add.data.home;
  assert.equal(currentHome(store).id, a.id);
  for (const [home, metres] of [
    [a, 2000],
    [b, 8000],
  ]) {
    assert.equal(
      (
        await call("/api/routes", "PUT", {
          homeId: home.id,
          homeVersion: home.version,
          routes: places.map((p, i) => ({
            placeId: p.id,
            metres: metres + i * 1000,
            seconds: 300,
          })),
        })
      ).status,
      200,
    );
  }
  assert.equal(store.list("routes").length, 14);
  assert.equal(homeRoutes(store, a)[0].metres, 2000);
  assert.equal(homeRoutes(store, b)[0].metres, 8000);
  assert.equal((await call("/api/visits", "POST", visitData)).status, 400);
  await call("/api/homes/current", "PUT", { homeId: b.id });
  const created = await call("/api/visits", "POST", {
    ...visitData,
    startingHomeId: a.id,
    startingHomeVersion: a.version,
  });
  assert.equal(created.status, 201);
  const visit = created.data.visit;
  assert.equal(visit.startingHomeSnapshot.label, "CB3 0LL");
  const rename = await call(`/api/homes/${a.id}`, "PATCH", {
    label: "Renamed home",
    colour: "#abcdef",
  });
  assert.equal(rename.data.home.version, a.version);
  assert.equal(homeRoutes(store, a).length, 7);
  const moved = (await call(`/api/homes/${a.id}`, "PATCH", { lat: 53 })).data
    .home;
  assert.notEqual(moved.version, a.version);
  assert.equal(
    (
      await call(`/api/homes/${a.id}`, "PATCH", {
        expectedVersion: a.version,
        lat: a.lat,
      })
    ).status,
    409,
  );
  assert.equal(store.get("homes", a.id).lat, 53);
  assert.equal(homeRoutes(store, moved).length, 0);
  assert.equal(homeRoutes(store, b).length, 7);
  assert.equal(store.list("routes").length, 14);
  assert.equal(
    (
      await call("/api/visits", "POST", {
        ...visitData,
        startingHomeId: a.id,
        startingHomeVersion: a.version,
      })
    ).status,
    400,
  );
  assert.equal((await call(`/api/homes/${b.id}`, "DELETE")).status, 400);
  assert.equal(currentHome(store).id, b.id);
  assert.equal(
    (await call(`/api/homes/${b.id}`, "DELETE", { replacementId: a.id }))
      .status,
    200,
  );
  assert.equal(currentHome(store).id, a.id);
  assert.equal((await call(`/api/homes/${a.id}`, "DELETE")).status, 400);
  assert.equal(
    (await call("/api/homes/current", "PUT", { homeId: b.id })).status,
    400,
  );
  assert.equal(
    (await call("/api/visits", "POST", { ...visitData, startingHomeId: b.id }))
      .status,
    400,
  );
  const edited = await call(`/api/visits/${visit.id}`, "PUT", {
    ...visit,
    title: "Edited title",
  });
  assert.equal(edited.status, 200);
  assert.deepEqual(
    edited.data.visit.startingHomeSnapshot,
    visit.startingHomeSnapshot,
  );
  const state = (await call("/api/state")).data;
  assert.equal(state.homes.length, 1);
  assert.equal(state.homeJourneys.length, 1);
  const exported = (await call("/api/export")).data;
  assert.equal(exported.homes.length, 2);
  assert.equal(exported.routes.length, 14);
});

test("each public home has its own rounded circle; private snapshots and drafts never enter the public payload", () => {
  const homes = [
    { ...initial, id: "a", colour: "#007a3b" },
    {
      ...initial,
      id: "b",
      label: "Second home",
      lat: 52.045,
      colour: "#3569a0",
    },
  ];
  const visits = [
    { ...visitData, id: "published", ...originFor(homes[0]) },
    {
      ...visitData,
      id: "draft",
      placeId: "1",
      published: false,
      ...originFor(homes[1]),
    },
  ];
  const routes = homes.flatMap((h) =>
    places.map((p, i) => ({
      homeId: h.id,
      homeVersion: h.version,
      placeId: p.id,
      metres: h.id === "a" ? (i + 1) * 2000 : (7 - i) * 2000,
      seconds: 300,
    })),
  );
  const result = publicJournal(places, visits, homes, routes, "a");
  assert.equal(result.visits.length, 1);
  assert.equal(result.visits[0].startingHomeLabel, "CB3 0LL");
  for (const key of [
    "startingHomeId",
    "startingHomeVersion",
    "startingHomeSnapshot",
    "homeVersion",
    "snapMetres",
  ])
    assert.equal(JSON.stringify(result).includes('"' + key + '"'), false);
  assert.equal(result.homes.length, 2);
  assert.notEqual(
    result.homes[0].queue[0].placeId,
    result.homes[1].queue[0].placeId,
  );
  assert.equal(result.homes[0].queue[0].placeId, "1"); // Draft visits are still unvisited publicly.
  for (const h of result.homes) {
    assert.equal(h.range.approximate, true);
    assert.deepEqual(h.range.centre, { lat: 52, lng: 0 });
    assert.equal(h.range.radius, haversine(h.range.centre, places[0]));
  }
});

test("a route job stays attached to its chosen home when the current home switches", async () => {
  const store = createStore(":memory:");
  store.put("settings", "home", initial);
  migrateHomes(store);
  const a = currentHome(store),
    b = { ...a, id: "b", label: "Other", lat: 53 };
  store.put("homes", b.id, b);
  try {
    await refreshDrivingRoutes({
      store,
      places,
      homeId: a.id,
      wait: async () => {},
      fetcher: async () => {
        store.put("settings", "activeHomeId", { value: b.id });
        return {
          ok: true,
          json: async () => ({
            code: "Ok",
            sources: [{ distance: 0 }],
            destinations: Array(8).fill({ distance: 0 }),
            distances: [[0, 1000, 2000, 3000, 4000, 5000, 6000, 7000]],
            durations: [[0, 100, 200, 300, 400, 500, 600, 700]],
          }),
        };
      },
    });
    assert.equal(currentHome(store).id, b.id);
    assert.equal(homeRoutes(store, a).length, 7);
    assert.equal(homeRoutes(store, b).length, 0);
    assert.equal(store.get("routes", routeKey(a, "0")).metres, 1000);
  } finally {
    store.close();
  }
});

test("removing a home during a route request cancels the batch without storing routes", async () => {
  const store = createStore(":memory:");
  store.put("settings", "home", initial);
  migrateHomes(store);
  const home = currentHome(store);
  try {
    await assert.rejects(
      refreshDrivingRoutes({
        store,
        places,
        homeId: home.id,
        wait: async () => {},
        fetcher: async () => {
          store.put("homes", home.id, {
            ...home,
            archivedAt: new Date().toISOString(),
          });
          return {
            ok: true,
            json: async () => ({
              code: "Ok",
              sources: [{ distance: 0 }],
              destinations: Array(8).fill({ distance: 0 }),
              distances: [Array(8).fill(1000)],
              durations: [Array(8).fill(100)],
            }),
          };
        },
      }),
      /Home changed/,
    );
    assert.equal(store.list("routes").length, 0);
  } finally {
    store.close();
  }
});

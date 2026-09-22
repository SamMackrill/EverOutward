import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../server/store.mjs";
import { refreshDrivingRoutes } from "../server/routing.mjs";
import { currentHome, homeRoutes, routeKey } from "../server/homes.mjs";
import { outward } from "../server/domain.mjs";

const home = { lat: 52, lng: 0, version: "home-1" };
const places = Array.from({ length: 7 }, (_, i) => ({
  id: String(i),
  lat: 52 + (i + 1) / 100,
  lng: 0,
}));
test("distances include visited places and are saved for reuse", async () => {
  const store = createStore(":memory:");
  store.put("settings", "home", home);
  store.put("visits", "v", { placeId: "0" });
  let calls = 0;
  const fetcher = async (url) => {
    calls++;
    assert.ok(url.includes("sources=0&annotations=distance,duration"));
    assert.equal(url.includes("0,52.01;"), true);
    return {
      ok: true,
      json: async () => ({
        code: "Ok",
        sources: [{ distance: 12 }],
        destinations: Array.from({ length: 8 }, () => ({ distance: 10 })),
        distances: [[0, 11000, 9000, 8000, 7000, 6000, 5000, 10000]],
        durations: [[0, 1100, 900, 800, 700, 600, 500, 1000]],
      }),
    };
  };
  try {
    const result = await refreshDrivingRoutes({
      store,
      places,
      fetcher,
      wait: async () => {},
    });
    assert.equal(result.calculated, 7);
    assert.equal(result.saved, 7);
    assert.equal(result.catalogueComplete, true);
    assert.deepEqual(
      result.ranked.map((p) => p.id),
      ["5", "4", "3", "2", "1"],
    );
    assert.equal(result.ranked[0].seconds, 500);
    assert.equal(result.complete, true);
    for (const route of store.list("routes"))
      store.put("routes", routeKey(currentHome(store), route.placeId), {
        ...route,
        checkedAt: "2020-01-01T00:00:00Z",
      });
    await refreshDrivingRoutes({
      store,
      places,
      fetcher,
      wait: async () => {},
    });
    assert.equal(calls, 1);
    assert.equal(
      store.get("routes", routeKey(currentHome(store), "5")).homeVersion,
      "home-1",
    );
    assert.equal(
      store.get("routes", routeKey(currentHome(store), "0")).metres,
      11000,
    );
  } finally {
    store.close();
  }
});
test("distant unknown places cannot change the next five; nearby unknowns remain provisional", () => {
  const known = places.slice(0, 5),
    routes = known.map((p, i) => ({
      placeId: p.id,
      metres: 4000 + i * 1000,
      seconds: 500,
      homeVersion: home.version,
    }));
  const far = { id: "far", lat: 55, lng: 0 };
  assert.equal(outward([...known, far], [], home, routes).complete, true);
  assert.equal(
    outward([...known, { id: "near", lat: 52.01, lng: 0 }], [], home, routes)
      .complete,
    false,
  );
});
test("unroutable and excessively snapped destinations are never invented", async () => {
  const store = createStore(":memory:");
  store.put("settings", "home", home);
  try {
    const result = await refreshDrivingRoutes({
      store,
      places: places.slice(0, 2),
      wait: async () => {},
      fetcher: async () => ({
        ok: true,
        json: async () => ({
          code: "Ok",
          sources: [{ distance: 0 }],
          destinations: [{ distance: 0 }, { distance: 1800 }, { distance: 5 }],
          distances: [[0, 12000, null]],
          durations: [[0, 900, null]],
        }),
      }),
    });
    assert.equal(result.calculated, 0);
    assert.equal(result.unavailable, 2);
    assert.equal(result.remaining, 2);
    assert.equal(result.catalogueComplete, false);
    assert.match(result.unavailablePlaces[0].reason, /visitor entrance/);
    assert.equal(result.complete, false);
    assert.equal(store.list("routes").length, 0);
  } finally {
    store.close();
  }
});

function tableResponse(url) {
  const count = new URL(url).pathname.split("/").at(-1).split(";").length;
  return {
    ok: true,
    json: async () => ({
      code: "Ok",
      sources: [{ distance: 0 }],
      destinations: Array.from({ length: count }, () => ({ distance: 0 })),
      distances: [Array.from({ length: count }, (_, i) => i * 1000)],
      durations: [Array.from({ length: count }, (_, i) => i * 100)],
    }),
  };
}

test("one run covers the whole catalogue beyond the next five and four batches", async () => {
  const store = createStore(":memory:");
  store.put("settings", "home", home);
  const catalogue = Array.from({ length: 128 }, (_, i) => ({
    id: String(i),
    lat: 52 + i / 100,
    lng: 0,
  }));
  let calls = 0;
  const options = {
    store,
    places: catalogue,
    wait: async () => {},
    fetcher: async (url) => {
      calls++;
      return tableResponse(url);
    },
  };
  try {
    const result = await refreshDrivingRoutes(options);
    assert.equal(result.saved, 128);
    assert.equal(result.remaining, 0);
    assert.equal(result.catalogueComplete, true);
    assert.equal(calls, 6);
    await refreshDrivingRoutes(options);
    assert.equal(calls, 6);
    const forced = await refreshDrivingRoutes({ ...options, force: true });
    assert.equal(forced.calculated, 128);
    assert.equal(calls, 12);
    store.put("homes", currentHome(store).id, {
      ...currentHome(store),
      lat: 53,
      version: "home-2",
    });
    const moved = await refreshDrivingRoutes(options);
    assert.equal(moved.calculated, 128);
    assert.ok(
      homeRoutes(store, currentHome(store)).every(
        (r) => r.homeVersion === "home-2",
      ),
    );
  } finally {
    store.close();
  }
});

test("an interrupted full calculation keeps its batches and resumes only missing places", async () => {
  const store = createStore(":memory:");
  store.put("settings", "home", home);
  const catalogue = Array.from({ length: 30 }, (_, i) => ({
    id: String(i),
    lat: 52 + i / 100,
    lng: 0,
  }));
  let calls = 0;
  try {
    await assert.rejects(
      refreshDrivingRoutes({
        store,
        places: catalogue,
        wait: async () => {},
        fetcher: async (url) => {
          if (++calls === 2)
            return { ok: false, json: async () => ({ code: "Error" }) };
          return tableResponse(url);
        },
      }),
      /already saved are kept/,
    );
    const firstBatch = store.list("routes");
    assert.equal(firstBatch.length, 25);
    const result = await refreshDrivingRoutes({
      store,
      places: catalogue,
      wait: async () => {},
      fetcher: async (url) => tableResponse(url),
    });
    assert.equal(result.calculated, 5);
    assert.equal(result.saved, 30);
    for (const route of firstBatch)
      assert.deepEqual(
        store.get("routes", routeKey(currentHome(store), route.placeId)),
        route,
      );
  } finally {
    store.close();
  }
});

test("a home change during calculation cannot save distances for the new home", async () => {
  const store = createStore(":memory:");
  store.put("settings", "home", home);
  try {
    await assert.rejects(
      refreshDrivingRoutes({
        store,
        places,
        wait: async () => {},
        fetcher: async (url) => {
          store.put("homes", currentHome(store).id, {
            ...currentHome(store),
            lat: 53,
            version: "moved",
          });
          return tableResponse(url);
        },
      }),
      /Home changed/,
    );
    assert.equal(store.list("routes").length, 0);
  } finally {
    store.close();
  }
});
test("routing service failure preserves saved data", async () => {
  const store = createStore(":memory:");
  store.put("settings", "home", home);
  store.put("routes", "0", {
    placeId: "0",
    metres: 4000,
    seconds: 300,
    homeVersion: home.version,
  });
  try {
    await assert.rejects(
      refreshDrivingRoutes({
        store,
        places,
        wait: async () => {},
        fetcher: async () => ({
          ok: false,
          json: async () => ({ code: "Error" }),
        }),
      }),
      /unavailable/,
    );
    assert.equal(
      store.get("routes", routeKey(currentHome(store), "0")).metres,
      4000,
    );
  } finally {
    store.close();
  }
});

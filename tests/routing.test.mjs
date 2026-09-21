import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../server/store.mjs";
import { refreshDrivingRoutes } from "../server/routing.mjs";
import { outward } from "../server/domain.mjs";

const home = { lat: 52, lng: 0, version: "home-1" };
const places = Array.from({ length: 7 }, (_, i) => ({
  id: String(i),
  lat: 52 + (i + 1) / 100,
  lng: 0,
}));
test("route batching, distance/time storage, visit exclusion and cached reuse", async () => {
  const store = createStore(":memory:");
  store.put("settings", "home", home);
  store.put("visits", "v", { placeId: "0" });
  let calls = 0;
  const fetcher = async (url) => {
    calls++;
    assert.ok(url.includes("sources=0&annotations=distance,duration"));
    assert.equal(url.includes("0,52.01;"), false);
    return {
      ok: true,
      json: async () => ({
        code: "Ok",
        sources: [{ distance: 12 }],
        destinations: Array.from({ length: 7 }, () => ({ distance: 10 })),
        distances: [[0, 9000, 8000, 7000, 6000, 5000, 10000]],
        durations: [[0, 900, 800, 700, 600, 500, 1000]],
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
    assert.equal(result.calculated, 6);
    assert.deepEqual(
      result.ranked.map((p) => p.id),
      ["5", "4", "3", "2", "1"],
    );
    assert.equal(result.ranked[0].seconds, 500);
    assert.equal(result.complete, true);
    await refreshDrivingRoutes({
      store,
      places,
      fetcher,
      wait: async () => {},
    });
    assert.equal(calls, 1);
    assert.equal(store.get("routes", "5").homeVersion, "home-1");
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
    assert.equal(result.complete, false);
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
    assert.equal(store.get("routes", "0").metres, 4000);
  } finally {
    store.close();
  }
});

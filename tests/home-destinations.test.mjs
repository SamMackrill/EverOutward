import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  placesForHome,
  placeMatchesHome,
} from "../server/home-destinations.mjs";
import { outward, haversine } from "../server/domain.mjs";
import { homeJourneys, publicJournal, routeKey } from "../server/homes.mjs";
import { createStore } from "../server/store.mjs";
import { distanceReviewRows } from "../server/distance-review.mjs";
import { refreshDrivingRoutes } from "../server/routing.mjs";

const homes = [
  { id: "ni", label: "Ardglass", lat: 54.26, lng: -5.61, version: "v1" },
  { id: "gb", label: "Girton", lat: 52.23, lng: 0.08, version: "v1" },
];
const places = [
  { id: "ni-visited", region: "Northern Ireland", lat: 54.3, lng: -5.6 },
  { id: "ni-next", region: "Northern Ireland", lat: 54.4, lng: -5.6 },
  { id: "gb-visited", region: "North", lat: 52.3, lng: 0.1 },
  { id: "gb-next", region: "North", lat: 52.4, lng: 0.1 },
];
const visits = [
  { id: "n", placeId: "ni-visited", published: true },
  { id: "g", placeId: "gb-visited", published: true },
];
const routes = homes.flatMap((home) =>
  places.map((place) => ({
    homeId: home.id,
    homeVersion: home.version,
    placeId: place.id,
    metres: 10000,
    seconds: 600,
    reviewed: true,
  })),
);

test("Ardglass gets the 29 NI catalogue sites and every other home excludes them", () => {
  const catalogue = JSON.parse(
    readFileSync("public/data/places.json", "utf8"),
  ).places;
  const ni = placesForHome(catalogue, homes[0]);
  assert.equal(ni.length, 29);
  assert.ok(ni.every((place) => place.region === "Northern Ireland"));
  for (const label of ["Girton", "Reading", "Balcombe"]) {
    const gb = placesForHome(catalogue, { label });
    assert.equal(gb.length, catalogue.length - ni.length);
    assert.ok(gb.every((place) => place.region !== "Northern Ireland"));
  }
  assert.equal(placesForHome(catalogue, null).length, catalogue.length);
  for (const label of [" ARDGLASS ", "Ardglass_Annex", "ArdglassHouse"]) {
    assert.deepEqual(placesForHome(places, { label }), places.slice(0, 2));
  }
});

test("private and public home lists, reviewed routes and circles stay on their side of the sea", () => {
  const privateJourneys = homeJourneys(
    places,
    visits,
    homes,
    routes,
    homes.map((home) => ({
      homeId: home.id,
      homeVersion: home.version,
      unavailablePlaces: places.map((place) => ({ placeId: place.id })),
    })),
  );
  const published = publicJournal(places, visits, homes, routes, homes[0].id);
  assert.equal(published.visits.length, visits.length);
  assert.deepEqual(
    published.queue.map((p) => p.placeId),
    ["ni-next"],
  );
  for (const [i, home] of homes.entries()) {
    const prefix = i === 0 ? "ni" : "gb";
    const progress = outward(places, visits, home, routes);
    assert.deepEqual(
      progress.allRanked.map((p) => p.id),
      [`${prefix}-next`],
    );
    assert.equal(progress.remainingCount, 1);
    assert.equal(progress.visitedCount, 1);
    for (const journeys of [privateJourneys, published.homes]) {
      const journey = journeys[i];
      assert.deepEqual(
        journey.destinations.map((p) => [p.placeId, p.position]),
        [[`${prefix}-next`, 1]],
      );
      assert.ok(
        journey.reviewedRoutes.every((r) => r.placeId.startsWith(prefix)),
      );
      assert.equal(
        journey.range.radius,
        haversine(journey.range.centre, places[i * 2]),
      );
      assert.equal(placeMatchesHome(places[i * 2], journey), true);
      assert.equal(placeMatchesHome(places[(1 - i) * 2], journey), false);
    }
    assert.equal(privateJourneys[i].total, 2);
    assert.equal(privateJourneys[i].saved, 2);
    assert.deepEqual(privateJourneys[i].unavailablePlaces, []);
    const allVisited = [...visits, { placeId: `${prefix}-next` }];
    const completed = publicJournal(
      places,
      allVisited.map((v) => ({ ...v, published: true })),
      homes,
      routes,
      home.id,
    ).homes[i];
    assert.deepEqual(completed.queue, []);
    assert.equal(
      completed.range.radius,
      haversine(completed.range.centre, places[i * 2 + 1]),
    );
  }
});

test("route refresh and reviews exclude crossings even with old saved routes and failures", async () => {
  for (const [i, home] of homes.entries()) {
    const store = createStore(":memory:");
    try {
      store.put("homes", home.id, home);
      const excluded = places[(1 - i) * 2];
      store.put(
        "routes",
        routeKey(home, excluded.id),
        routes.find((r) => r.homeId === home.id && r.placeId === excluded.id),
      );
      store.put("routeReports", JSON.stringify([home.id, home.version]), {
        unavailablePlaces: [{ placeId: excluded.id }],
      });
      const calls = [];
      const result = await refreshDrivingRoutes({
        store,
        places,
        homeId: home.id,
        wait: async () => {},
        fetcher: async (url) => {
          const coordinates = url
            .split("/driving/")[1]
            .split("?")[0]
            .split(";");
          calls.push(coordinates);
          return {
            ok: true,
            json: async () => ({
              code: "Ok",
              sources: [{ distance: 0 }],
              destinations: coordinates.map(() => ({ distance: 0 })),
              distances: [coordinates.map(() => 10000)],
              durations: [coordinates.map(() => 600)],
            }),
          };
        },
      });
      assert.deepEqual(calls, [
        [home, ...places.slice(i * 2, i * 2 + 2)].map(
          (p) => `${p.lng},${p.lat}`,
        ),
      ]);
      assert.equal(result.total, 2);
      assert.equal(result.saved, 2);
      assert.equal(result.remaining, 0);
      assert.equal(result.catalogueComplete, true);
      assert.deepEqual(result.unavailablePlaces, []);
      assert.deepEqual(
        distanceReviewRows(store, home, places).map((r) => r.placeId),
        places.slice(i * 2, i * 2 + 2).map((p) => p.id),
      );
      assert.ok(
        store.get("routes", routeKey(home, excluded.id)),
        "keep historical saved data",
      );
    } finally {
      store.close();
    }
  }
});

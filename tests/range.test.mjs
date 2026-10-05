import { test } from "node:test";
import assert from "node:assert/strict";
import {
  visitRange,
  haversine,
  outward,
  publicRange,
} from "../server/domain.mjs";
import { publicJournal, homeJourneys } from "../server/homes.mjs";

test("special open days stay ranked but cannot bound any home's private or public circle", () => {
  const homes = [
    { id: "a", lat: 52, lng: 0, version: "v1" },
    { id: "b", lat: 52.1, lng: 0, version: "v2" },
  ];
  const places = [
    // Use a reviewed ID without a flag to cover unenriched server catalogues.
    { id: "207a7c87-e721-49cf-a5a9-f9d14cb7c821", lat: 52.02, lng: 0 },
    { id: "visited", lat: 52.2, lng: 0 },
    { id: "regular", lat: 52.4, lng: 0 },
  ];
  const visits = [{ id: "v", placeId: "visited", published: true }];
  const routes = homes.flatMap((home) =>
    places.map((p, i) => ({
      homeId: home.id,
      homeVersion: home.version,
      placeId: p.id,
      metres: (i + 1) * 30000,
      seconds: 1800,
    })),
  );
  for (const home of homes) {
    const progress = outward(places, visits, home, routes);
    assert.equal(progress.ranked[0].id, places[0].id);
    assert.equal(progress.radius, haversine(home, places[1]));
    assert.deepEqual(
      progress.rangeCandidates.map((p) => p.id),
      ["regular"],
    );
  }
  for (const home of homeJourneys(places, visits, homes, routes))
    assert.equal(home.range.radius, haversine(home.range.centre, places[1]));
  for (const home of publicJournal(places, visits, homes, routes, "a").homes) {
    assert.equal(home.queue[0].placeId, places[0].id);
    assert.equal(home.range.radius, haversine(home.range.centre, places[1]));
  }
});

test("a missing limited-access route does not hide the circle, and only special places remaining allows the farthest visit", () => {
  const home = { lat: 52, lng: 0, version: "v1" };
  const places = [
    { id: "special", limitedAccess: true, lat: 52.01, lng: 0 },
    { id: "visited", lat: 52.2, lng: 0 },
    { id: "regular", lat: 52.4, lng: 0 },
  ];
  const routes = [{ placeId: "regular", metres: 60000, homeVersion: "v1" }];
  const visits = [{ placeId: "visited" }];
  const progress = outward(places, visits, home, routes);
  assert.equal(progress.complete, true);
  assert.equal(progress.rangeComplete, true);
  assert.equal(progress.radius, haversine(home, places[1]));
  visits.push({ placeId: "regular" });
  const finished = outward(places, visits, home, routes);
  assert.equal(finished.remainingCount, 1);
  assert.equal(finished.rangeComplete, true);
  assert.equal(finished.radius, haversine(home, places[2]));
  assert.equal(
    publicRange(places, visits, home, finished).radius,
    finished.radius,
  );
  // Visiting a special place still extends progress within the ordinary gate.
  const visitedSpecial = {
    id: "other-special",
    limitedAccess: true,
    lat: 52.3,
    lng: 0,
  };
  assert.equal(
    outward(
      [...places, visitedSpecial],
      [{ placeId: "visited" }, { placeId: "other-special" }],
      home,
      routes,
    ).radius,
    haversine(home, visitedSpecial),
  );
});

test("the circle searches beyond five special destinations for an ordinary gate", () => {
  const home = { lat: 52, lng: 0, version: "v1" };
  const places = Array.from({ length: 6 }, (_, i) => ({
    id: String(i),
    limitedAccess: true,
    lat: 52 + (i + 1) / 100,
    lng: 0,
  }));
  const visited = { id: "visited", lat: 52.1, lng: 0 };
  const gate = { id: "ordinary", lat: 52.2, lng: 0 };
  const catalogue = [...places, visited, gate];
  const routes = catalogue.map((p, i) => ({
    placeId: p.id,
    metres: (i + 1) * 5000,
    homeVersion: "v1",
  }));
  const result = outward(catalogue, [{ placeId: visited.id }], home, routes);
  assert.equal(result.ranked.length, 5);
  assert.equal(
    result.ranked.every((p) => p.limitedAccess),
    true,
  );
  assert.equal(result.radius, haversine(home, visited));
});

test("range reaches the outermost visited place inside the nearest straight-line gate", () => {
  const home = { lat: 52, lng: 0, version: "v1" };
  const places = [
    { id: "near", lat: 52.01, lng: 0 },
    { id: "edge", lat: 52.02, lng: 0 },
    { id: "next", lat: 52.03, lng: 0 },
    { id: "holiday", lat: 55, lng: -6 },
  ];
  const visits = ["near", "edge", "edge", "holiday"].map((placeId) => ({
    placeId,
  }));
  assert.equal(
    visitRange(places, visits, home, places[2]),
    haversine(home, places[1]),
  );
  assert.equal(
    visitRange(
      places,
      visits.filter((v) => v.placeId !== "edge"),
      home,
      places[2],
    ),
    haversine(home, places[0]),
  );
  assert.equal(visitRange(places, [], home, places[2]), 0);
  assert.equal(visitRange(places, visits, null, places[2]), 0);
  assert.equal(visitRange(places, visits, home, null), 0);
  assert.equal(
    visitRange(places, visits, home, null, true),
    haversine(home, places[3]),
  );
  const routes = [
    { placeId: "next", metres: 6000, seconds: 600, homeVersion: "v1" },
  ];
  assert.equal(
    outward(places, visits, home, routes).radius,
    haversine(home, places[1]),
  );
  assert.equal(
    outward(places, visits, { ...home, version: "v2" }, routes).radius,
    haversine(home, places[1]),
  );
});

test("public range uses rounded coordinates and recalculates its radius from that centre", () => {
  const home = {
    lat: 52.23456,
    lng: 0.07654,
    label: "Private",
    version: "secret",
  };
  const places = [
    { id: "visited", lat: 52.3, lng: 0.1 },
    { id: "next", lat: 52.5, lng: 0.1 },
  ];
  const visits = [{ placeId: "visited" }];
  const result = publicRange(places, visits, home, {
    complete: true,
    ranked: [places[1]],
    remainingCount: 1,
  });
  assert.deepEqual(result.centre, { lat: 52.2, lng: 0.1 });
  assert.equal(result.approximate, true);
  assert.equal(result.radius, haversine(result.centre, places[0]));
  assert.notEqual(result.radius, haversine(home, places[0]));
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.equal(publicRange(places, visits, null, {}), null);
});

test("missing and changed road routes cannot change the queue or expand the circle", () => {
  const home = { lat: 54.3, lng: -5.6, version: "v1" };
  const places = [
    { id: "castle", lat: 54.4, lng: -5.6 },
    { id: "lough", lat: 54.41, lng: -5.6 },
    { id: "next", lat: 54.44, lng: -5.6 },
    { id: "unrouted", lat: 54.5, lng: -5.6 },
    { id: "far-visit", lat: 54.6, lng: -5.6 },
  ];
  const visits = ["castle", "lough", "far-visit"].map((placeId) => ({
    placeId,
  }));
  const routes = [
    {
      placeId: "next",
      metres: 27000,
      seconds: 1500,
      homeVersion: home.version,
    },
  ];
  const result = outward(places, visits, home, routes);
  assert.equal(result.complete, true);
  assert.equal(result.blockingPendingCount, 0);
  assert.equal(result.pendingCount, 1);
  assert.equal(result.rangeComplete, true);
  assert.equal(result.radius, haversine(home, places[1]));
  assert.equal(publicRange(places, visits, home, result).confirmed, true);
  assert.equal(publicRange(places, visits, home, result).radius, result.radius);
  // A shorter road route does not change the challenge order or its circle.
  const resolved = outward(places, visits, home, [
    ...routes,
    { placeId: "unrouted", metres: 24000, homeVersion: home.version },
  ]);
  assert.equal(resolved.complete, true);
  assert.equal(resolved.ranked[0].id, "next");
  assert.deepEqual(
    resolved.ranked.map((p) => p.id),
    result.ranked.map((p) => p.id),
  );
  assert.equal(resolved.radius, result.radius);
  // A visit beyond the nearest unvisited place cannot expand the circle.
  const between = { id: "between", lat: 54.46, lng: -5.6 };
  const uncertain = outward(
    [...places, between],
    [...visits, { placeId: "between" }],
    home,
    routes,
  );
  assert.equal(uncertain.rangeComplete, true);
  assert.equal(uncertain.radius, result.radius);
  assert.equal(
    publicRange(
      [...places, between],
      [...visits, { placeId: "between" }],
      home,
      uncertain,
    ).confirmed,
    true,
  );
});

test("missing routes affecting only later queue positions do not hold up the circle", () => {
  const home = { lat: 52, lng: 0, version: "v1" };
  const places = [
    { id: "visited", lat: 52.01, lng: 0 },
    { id: "next", lat: 52.03, lng: 0 },
    { id: "unrouted", lat: 52.2, lng: 0 },
  ];
  const visits = [{ placeId: "visited" }];
  const result = outward(places, visits, home, [
    { placeId: "next", metres: 5000, homeVersion: home.version },
  ]);
  assert.equal(result.complete, true);
  assert.equal(result.rangeComplete, true);
  assert.equal(result.radius, haversine(home, places[0]));
  const moved = outward(places, visits, { ...home, version: "v2" }, [
    { placeId: "next", metres: 5000, homeVersion: home.version },
  ]);
  assert.equal(moved.rangeComplete, true);
  assert.equal(moved.radius, result.radius);
});

test("public circle uses the saved straight-line gate with distances recomputed from its rounded centre", () => {
  const home = { lat: 52.049, lng: 0, version: "v1" };
  const places = [
    { id: "visited", lat: 52.05, lng: 0 },
    { id: "known", lat: 52.06, lng: 0 },
    { id: "unknown", lat: 52.03, lng: 0 },
  ];
  const visits = [{ placeId: "visited" }];
  const result = outward(places, visits, home, [
    { placeId: "known", metres: 5000, homeVersion: home.version },
  ]);
  assert.equal(result.rangeComplete, true);
  const published = publicRange(places, visits, home, result);
  assert.equal(result.ranked[0].id, "known");
  assert.equal(published.confirmed, true);
  assert.equal(published.radius, haversine(published.centre, places[0]));
  assert.notEqual(published.radius, result.radius);
});

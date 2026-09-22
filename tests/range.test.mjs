import { test } from "node:test";
import assert from "node:assert/strict";
import {
  visitRange,
  haversine,
  outward,
  publicRange,
} from "../server/domain.mjs";

test("range reaches the outermost visited place inside the next road-ranked gate", () => {
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
    0,
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

test("a provisional road queue cannot suppress a circle whose visited extent is already certain", () => {
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
  assert.equal(result.complete, false);
  assert.equal(result.blockingPendingCount, 1);
  assert.equal(result.rangeComplete, true);
  assert.equal(result.radius, haversine(home, places[1]));
  assert.equal(publicRange(places, visits, home, result).confirmed, true);
  assert.equal(publicRange(places, visits, home, result).radius, result.radius);
  // If this missing distance later changes the road winner, the circle stays put.
  const resolved = outward(places, visits, home, [
    ...routes,
    { placeId: "unrouted", metres: 24000, homeVersion: home.version },
  ]);
  assert.equal(resolved.complete, true);
  assert.equal(resolved.ranked[0].id, "unrouted");
  assert.equal(resolved.radius, result.radius);
  // A visit between the two possible gates makes the circle genuinely uncertain.
  const between = { id: "between", lat: 54.46, lng: -5.6 };
  const uncertain = outward(
    [...places, between],
    [...visits, { placeId: "between" }],
    home,
    routes,
  );
  assert.equal(uncertain.rangeComplete, false);
  assert.equal(uncertain.radius, 0);
  assert.equal(
    publicRange(
      [...places, between],
      [...visits, { placeId: "between" }],
      home,
      uncertain,
    ).confirmed,
    false,
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
  assert.equal(result.complete, false);
  assert.equal(result.rangeComplete, true);
  assert.equal(result.radius, haversine(home, places[0]));
  const moved = outward(places, visits, { ...home, version: "v2" }, [
    { placeId: "next", metres: 5000, homeVersion: home.version },
  ]);
  assert.equal(moved.rangeComplete, false);
  assert.equal(moved.radius, 0);
});

test("public circle confirmation is recomputed after rounding the home centre", () => {
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
  assert.equal(published.confirmed, false);
  assert.equal(published.radius, 0);
});

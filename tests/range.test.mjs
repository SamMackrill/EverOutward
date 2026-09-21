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

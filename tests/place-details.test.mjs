import { test } from "node:test";
import assert from "node:assert/strict";
import { haversine, outward } from "../server/domain.mjs";
import { homeJourneys, publicJournal } from "../server/homes.mjs";

const places = Array.from({ length: 8 }, (_, i) => ({
  id: `p${i + 1}`,
  name: `Place ${i + 1}`,
  lat: 52 + (i + 1) / 100,
  lng: 0,
  limitedAccess: i === 0,
}));
const homes = [
  { id: "a", label: "Home A", lat: 52.001, lng: 0, version: "a1" },
  { id: "b", label: "Home B", lat: 52.089, lng: 0, version: "b1" },
  { id: "removed", lat: 53, lng: 0, archivedAt: "2026-10-01" },
];
const visits = [{ placeId: "p2", published: true }];
const routes = [
  {
    homeId: "a",
    homeVersion: "a1",
    placeId: "p8",
    metres: 123000,
    seconds: 3600,
    walkingMetres: 2000,
    walkingSeconds: 1800,
    walkingNote: "Check the footpath.",
  },
  {
    homeId: "b",
    homeVersion: "b1",
    placeId: "p8",
    metres: 28000,
    seconds: 1500,
  },
  {
    homeId: "a",
    homeVersion: "a1",
    placeId: "p7",
    metres: 5000,
    seconds: 100,
    reviewRequired: true,
  },
  {
    homeId: "a",
    homeVersion: "a1",
    placeId: "p6",
    metres: 6000,
    seconds: 200,
    destinationVersion: "old-entrance",
  },
  {
    homeId: "b",
    homeVersion: "old-home",
    placeId: "p5",
    metres: 7000,
    seconds: 300,
  },
];

test("place details carry every home's full unvisited rank and its valid saved route", () => {
  const journeys = homeJourneys(places, visits, homes, routes);
  assert.equal(journeys.length, 2);
  assert.equal(journeys[0].destinations.length, 7);
  for (const journey of journeys) {
    const home = homes.find((h) => h.id === journey.id);
    const expected = outward(places, visits, home, routes);
    assert.deepEqual(
      journey.destinations.map((p) => p.placeId),
      expected.allRanked.map((p) => p.id),
    );
    assert.deepEqual(
      journey.destinations.map((p) => p.position),
      [1, 2, 3, 4, 5, 6, 7],
    );
    assert.ok(!journey.destinations.some((p) => p.placeId === "p2"));
    assert.equal(journey.queue.length, 5);
    assert.deepEqual(
      journey.queue,
      journey.destinations.slice(0, 5).map(({ position, ...entry }) => entry),
    );
    for (const entry of journey.destinations) {
      assert.equal(
        entry.geographicMetres,
        haversine(
          home,
          places.find((p) => p.id === entry.placeId),
        ),
      );
      assert.equal(entry.geographicApproximate, false);
    }
  }
  const a = journeys[0].destinations.find((p) => p.placeId === "p8");
  const b = journeys[1].destinations.find((p) => p.placeId === "p8");
  assert.equal(a.position, 7);
  assert.equal(b.position, 1);
  assert.equal(a.metres, 123000);
  assert.equal(b.metres, 28000);
  assert.equal(a.walkingMetres, 2000);
  assert.equal(a.walkingNote, "Check the footpath.");
  assert.equal(b.walkingMetres, undefined);
  for (const [homeId, placeId] of [
    ["a", "p7"],
    ["a", "p6"],
    ["b", "p5"],
  ]) {
    const entry = journeys
      .find((h) => h.id === homeId)
      .destinations.find((p) => p.placeId === placeId);
    assert.equal(entry.metres, undefined);
    assert.ok(
      entry.position > 0,
      "an unavailable driving estimate must retain its geographic position",
    );
  }
  const afterVisit = homeJourneys(
    places,
    [...visits, { placeId: "p1" }],
    homes,
    routes,
  );
  assert.equal(
    afterVisit[0].destinations.find((p) => p.placeId === "p8").position,
    6,
  );
  assert.equal(
    afterVisit[1].destinations.find((p) => p.placeId === "p8").position,
    1,
  );
});

test("public details preserve exact ranks beyond five while distances use each rounded home centre", () => {
  const privateJourneys = homeJourneys(places, visits, homes, routes);
  const journal = publicJournal(places, visits, homes, routes, "a");
  for (const journey of journal.homes) {
    const original = privateJourneys.find((h) => h.id === journey.id);
    assert.deepEqual(
      journey.destinations.map((p) => [p.placeId, p.position]),
      original.destinations.map((p) => [p.placeId, p.position]),
    );
    for (const entry of journey.destinations) {
      assert.equal(entry.geographicApproximate, true);
      assert.equal(
        entry.geographicMetres,
        haversine(
          journey.range.centre,
          places.find((p) => p.id === entry.placeId),
        ),
      );
      assert.notEqual(
        entry.geographicMetres,
        original.destinations.find((p) => p.placeId === entry.placeId)
          .geographicMetres,
      );
    }
  }
  assert.equal(
    journal.homes[0].destinations.find((p) => p.placeId === "p8").position,
    7,
  );
  assert.equal(
    journal.homes[0].destinations.find((p) => p.placeId === "p8").metres,
    123000,
  );
  for (const key of ["homeVersion", "startingHomeSnapshot", "lat", "lng"]) {
    assert.ok(
      journal.homes.every((h) =>
        h.destinations.every((entry) => !(key in entry)),
      ),
    );
  }
  assert.equal(JSON.stringify(journal).includes("52.001"), false);
  assert.equal(JSON.stringify(journal).includes("52.089"), false);
});

test("equal-distance positions use the same stable tie break as next to visit", () => {
  const tied = ["z", "a", "b"].map((id) => ({ id, lat: 52.01, lng: 0 }));
  const [journey] = homeJourneys(tied, [], homes.slice(0, 1), []);
  assert.deepEqual(
    journey.destinations.map((p) => [p.placeId, p.position]),
    [
      ["a", 1],
      ["b", 2],
      ["z", 3],
    ],
  );
});

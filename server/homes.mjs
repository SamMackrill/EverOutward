import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import {
  outward,
  publicRange,
  publicVisit,
  routeMatchesPlace,
  isReviewedRoute,
} from "./domain.mjs";

export const routeKey = (home, placeId) =>
  JSON.stringify([home.id, home.version, placeId]);
export const currentHome = (store) =>
  store.get("homes", store.get("settings", "activeHomeId")?.value || "");
export const liveHomes = (store) =>
  store.list("homes").filter((h) => !h.archivedAt);
export const homeRoutes = (store, home) =>
  home
    ? store
        .list("routes")
        .filter((r) => r.homeId === home.id && r.homeVersion === home.version)
    : [];
export const originFor = (home) => ({
  startingHomeId: home.id,
  startingHomeVersion: home.version,
  startingHomeSnapshot: {
    label: home.label,
    colour: home.colour,
    lat: home.lat,
    lng: home.lng,
  },
});

export function migrateHomes(store) {
  if (store.get("settings", "homesSchema")?.version === 2) return;
  const legacy = store.get("settings", "home");
  if (store.filename !== ":memory:")
    store.backup(
      join(
        dirname(store.filename),
        "backups",
        `before-multiple-homes-${Date.now()}-${randomUUID()}.sqlite`,
      ),
    );
  store.transaction(() => {
    if (store.get("settings", "homesSchema")?.version === 2) return;
    if (legacy) {
      const home = {
        ...legacy,
        id: randomUUID(),
        colour: "#007a3b",
        archivedAt: null,
        createdAt: new Date().toISOString(),
      };
      store.put("homes", home.id, home);
      store.put("settings", "activeHomeId", { value: home.id });
      for (const row of store.snapshot().filter((r) => r.kind === "routes")) {
        const route = JSON.parse(row.payload);
        if (route.homeVersion === home.version)
          store.put("routes", routeKey(home, route.placeId), {
            ...route,
            homeId: home.id,
          });
        else store.put("legacyRoutes", row.id, route);
        store.delete("routes", row.id);
      }
      // The owner confirmed all existing trips started from the current home.
      for (const row of store.snapshot().filter((r) => r.kind === "visits")) {
        const visit = JSON.parse(row.payload);
        if (!visit.startingHomeId)
          store.put("visits", row.id, { ...visit, ...originFor(home) });
      }
      store.delete("settings", "home");
    }
    store.put("settings", "homesSchema", { version: 2 });
  });
}

export function homeJourneys(
  places,
  visits,
  homes,
  routes,
  reports = [],
  approximate = false,
) {
  return homes
    .filter((h) => !h.archivedAt)
    .map((home) => {
      const saved = routes.filter(
        (r) =>
          r.homeId === home.id &&
          r.homeVersion === home.version &&
          places.some((p) => p.id === r.placeId && routeMatchesPlace(r, p)),
      );
      const journey = outward(places, visits, home, saved);
      return {
        id: home.id,
        label: home.label,
        colour: home.colour,
        range: approximate
          ? publicRange(places, visits, home, journey)
          : {
              centre: { lat: home.lat, lng: home.lng },
              radius: journey.radius,
              confirmed: journey.rangeComplete,
              approximate: false,
            },
        queue: journey.ranked.map(
          ({
            id,
            metres,
            seconds,
            walkingMetres,
            walkingSeconds,
            walkingNote,
          }) => ({
            placeId: id,
            metres,
            seconds,
            walkingMetres,
            walkingSeconds,
            walkingNote,
          }),
        ),
        complete: journey.complete,
        pendingCount: journey.blockingPendingCount,
        reviewedRoutes: saved
          .filter(isReviewedRoute)
          .map(
            ({
              placeId,
              metres,
              seconds,
              source,
              checkedAt,
              walkingMetres,
              walkingSeconds,
              walkingNote,
            }) => ({
              placeId,
              metres,
              seconds,
              source,
              checkedAt,
              walkingMetres,
              walkingSeconds,
              walkingNote,
            }),
          ),
        ...(approximate
          ? {}
          : {
              saved: saved.length,
              total: places.length,
              unavailablePlaces: (
                reports.find(
                  (r) => r.homeId === home.id && r.homeVersion === home.version,
                )?.unavailablePlaces || []
              ).filter((p) => !saved.some((r) => r.placeId === p.placeId)),
            }),
      };
    });
}

export function publicJournal(places, visits, homes, routes, activeHomeId) {
  const published = visits.filter((v) => v.published);
  const journeys = homeJourneys(places, published, homes, routes, [], true);
  const current = journeys.find((h) => h.id === activeHomeId);
  return {
    version: 2,
    visits: published.map((visit) => publicVisit(visit, homes)),
    homes: journeys,
    activeHomeId,
    queue: current?.queue || [],
    range: current?.range || null,
    complete: current?.complete || false,
    pendingCount: current?.pendingCount || 0,
  };
}

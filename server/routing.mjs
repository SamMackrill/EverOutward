import { setTimeout as delay } from "node:timers/promises";
import { haversine, outward, routeMatchesPlace } from "./domain.mjs";
import { currentHome, homeRoutes, migrateHomes, routeKey } from "./homes.mjs";
import { boatAccess } from "./access-rules.mjs";

const endpoint =
  "https://routing.openstreetmap.de/routed-car/table/v1/driving/";
let lastRequest = 0;
export async function refreshDrivingRoutes({
  store,
  places,
  fetcher = fetch,
  wait = delay,
  force = false,
  onProgress = () => {},
  homeId,
  onlyPlaceIds,
  reviewed = false,
}) {
  migrateHomes(store);
  const home = homeId ? store.get("homes", homeId) : currentHome(store);
  if (!home || home.archivedAt)
    throw new Error("Set your home before calculating driving distances.");
  const candidates = [...places].sort(
    (a, b) =>
      haversine(home, a.entrance || a) - haversine(home, b.entrance || b),
  );
  const available = () =>
    homeRoutes(store, home).filter((r) =>
      places.some((p) => p.id === r.placeId && routeMatchesPlace(r, p)),
    );
  const known = new Set(available().map((r) => r.placeId));
  const pending = candidates.filter(
    (p) =>
      (!onlyPlaceIds || onlyPlaceIds.includes(p.id)) &&
      (force || !known.has(p.id)),
  );
  const failures = new Map(
    (
      store.get("routeReports", JSON.stringify([home.id, home.version]))
        ?.unavailablePlaces || []
    )
      .filter((p) => !known.has(p.placeId))
      .map((p) => [p.placeId, p]),
  );
  let calculated = 0;
  for (let offset = 0; offset < pending.length; offset += 25) {
    const next = pending.slice(offset, offset + 25);
    await wait(Math.max(0, 1100 - (Date.now() - lastRequest)));
    lastRequest = Date.now();
    const coords = [home, ...next.map((p) => p.entrance || p)]
      .map((p) => `${p.lng},${p.lat}`)
      .join(";");
    const response = await fetcher(
      `${endpoint}${coords}?sources=0&annotations=distance,duration`,
      {
        headers: {
          "User-Agent":
            "EverOutward/0.1 (+https://quartz-oyster-7zxz.here.now/)",
        },
        signal: AbortSignal.timeout(30000),
      },
    );
    const data = await response.json();
    if (!response.ok || data.code !== "Ok")
      throw new Error(
        "The routing service is unavailable. Distances already saved are kept; run the calculation again to finish the remaining places.",
      );
    if (!data.sources?.[0] || data.sources[0].distance > 1000)
      throw new Error(
        "Home is too far from a routable road. Check your starting coordinates.",
      );
    store.transaction(() => {
      if (
        store.get("homes", home.id)?.version !== home.version ||
        store.get("homes", home.id)?.archivedAt
      )
        throw new Error(
          "Home changed while routes were being calculated. Please retry.",
        );
      next.forEach((p, index) => {
        if (
          (store.get("placeCorrections", p.id)?.version || "catalogue") !==
          (p.entrance?.version || "catalogue")
        )
          throw new Error(
            "A visitor entrance changed while distances were being calculated. Retry this route.",
          );
        const key = routeKey(home, p.id),
          oldRoute = store.get("routes", key),
          review = store.get("routeReviews", key);
        const metres = data.distances?.[0]?.[index + 1],
          seconds = data.durations?.[0]?.[index + 1],
          destination = data.destinations?.[index + 1];
        if (
          !Number.isFinite(metres) ||
          metres < 0 ||
          !Number.isFinite(seconds) ||
          seconds < 0 ||
          !destination ||
          !Number.isFinite(destination.distance) ||
          destination.distance < 0 ||
          (!p.entrance && boatAccess[p.id])
        ) {
          const failure = {
            placeId: p.id,
            name: p.name,
            reason:
              !p.entrance && boatAccess[p.id]
                ? boatAccess[p.id].note
                : "No car route returned; check road access and the visitor entrance.",
          };
          failures.set(p.id, failure);
          if (oldRoute)
            store.put("routes", key, { ...oldRoute, reviewRequired: true });
          store.put("routeReviews", key, {
            ...review,
            homeId: home.id,
            homeVersion: home.version,
            placeId: p.id,
            open: true,
            reason: failure.reason,
            updatedAt: new Date().toISOString(),
          });
          return;
        }
        failures.delete(p.id);
        // OSRM's snap gap is a straight-line distance, not a pedestrian route.
        // Keep it separate from the driving distance used to order the next five.
        const walking =
          destination.distance > 1000
            ? {
                walkingMetres: Math.round(destination.distance),
                walkingSeconds: Math.ceil((destination.distance / 4000) * 3600),
                walkingNote:
                  "Additional walk estimated from the straight-line gap between the routed road and destination, at 4 km/h, one way. Paths, terrain and access may change the distance and time; this is not a verified walking route.",
              }
            : {};
        store.put("routes", routeKey(home, p.id), {
          homeId: home.id,
          placeId: p.id,
          metres,
          seconds,
          ...walking,
          homeVersion: home.version,
          checkedAt: new Date().toISOString(),
          source: "OSRM / FOSSGIS — estimated fastest car route",
          snapMetres: destination.distance,
          destinationVersion: p.entrance?.version || "catalogue",
          reviewed: !!(
            reviewed ||
            review ||
            p.entrance ||
            oldRoute?.reviewed ||
            walking.walkingMetres
          ),
        });
        if (review || reviewed)
          store.put("routeReviews", key, {
            ...review,
            homeId: home.id,
            homeVersion: home.version,
            placeId: p.id,
            open: false,
            updatedAt: new Date().toISOString(),
          });
        calculated++;
      });
    });
    onProgress({
      processed: Math.min(offset + next.length, pending.length),
      requested: pending.length,
      calculated,
      unavailable: failures.size,
    });
  }
  const placeIds = new Set(places.map((p) => p.id));
  const unavailablePlaces = [...failures.values()].filter((p) =>
    placeIds.has(p.placeId),
  );
  const saved = available().filter((r) => placeIds.has(r.placeId)).length;
  const result = {
    calculated,
    saved,
    total: places.length,
    remaining: places.length - saved,
    catalogueComplete: saved === places.length,
    homeVersion: home.version,
    homeId: home.id,
    unavailable: unavailablePlaces.length,
    unavailablePlaces,
    ...outward(places, store.list("visits"), home, available()),
  };
  store.put("routeReports", JSON.stringify([home.id, home.version]), {
    homeId: home.id,
    homeVersion: home.version,
    checkedAt: new Date().toISOString(),
    saved,
    total: places.length,
    unavailablePlaces,
  });
  return result;
}

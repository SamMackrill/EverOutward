import { setTimeout as delay } from "node:timers/promises";
import { haversine, outward } from "./domain.mjs";
import { currentHome, homeRoutes, migrateHomes, routeKey } from "./homes.mjs";

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
}) {
  migrateHomes(store);
  const home = homeId ? store.get("homes", homeId) : currentHome(store);
  if (!home || home.archivedAt)
    throw new Error("Set your home before calculating driving distances.");
  const candidates = [...places].sort(
    (a, b) => haversine(home, a) - haversine(home, b),
  );
  const available = () => homeRoutes(store, home);
  const known = new Set(available().map((r) => r.placeId));
  const pending = candidates.filter((p) => force || !known.has(p.id));
  const unavailablePlaces = [];
  let calculated = 0;
  for (let offset = 0; offset < pending.length; offset += 25) {
    const next = pending.slice(offset, offset + 25);
    await wait(Math.max(0, 1100 - (Date.now() - lastRequest)));
    lastRequest = Date.now();
    const coords = [home, ...next].map((p) => `${p.lng},${p.lat}`).join(";");
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
          destination.distance > 1000
        ) {
          unavailablePlaces.push({
            placeId: p.id,
            name: p.name,
            reason:
              destination?.distance > 1000
                ? "Catalogue point is more than 1 km from a routable road; check the visitor entrance."
                : "No car route returned; check road access and the visitor entrance.",
          });
          return;
        }
        store.put("routes", routeKey(home, p.id), {
          homeId: home.id,
          placeId: p.id,
          metres,
          seconds,
          homeVersion: home.version,
          checkedAt: new Date().toISOString(),
          source: "OSRM / FOSSGIS — estimated fastest car route",
          snapMetres: destination.distance,
        });
        calculated++;
      });
    });
    onProgress({
      processed: Math.min(offset + next.length, pending.length),
      requested: pending.length,
      calculated,
      unavailable: unavailablePlaces.length,
    });
  }
  const placeIds = new Set(places.map((p) => p.id));
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

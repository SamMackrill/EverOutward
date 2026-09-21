import { setTimeout as delay } from "node:timers/promises";
import { haversine, outward } from "./domain.mjs";

const endpoint =
  "https://routing.openstreetmap.de/routed-car/table/v1/driving/";
let lastRequest = 0;
export async function refreshDrivingRoutes({
  store,
  places,
  fetcher = fetch,
  wait = delay,
}) {
  const home = store.get("settings", "home");
  if (!home)
    throw new Error("Set your home before calculating driving distances.");
  const visited = new Set(store.list("visits").map((v) => v.placeId));
  const candidates = places
    .filter((p) => !visited.has(p.id))
    .sort((a, b) => haversine(home, a) - haversine(home, b));
  const age = Date.now() - 7 * 86400000;
  const available = () =>
    store
      .list("routes")
      .filter(
        (r) =>
          r.homeVersion === home.version &&
          (!r.source?.startsWith("OSRM") || Date.parse(r.checkedAt) > age),
      );
  const attempted = new Set();
  let calculated = 0,
    unavailable = 0;
  for (let batch = 0; batch < 4; batch++) {
    const routes = available(),
      progress = outward(places, store.list("visits"), home, routes);
    if (progress.complete) break;
    const known = new Set(routes.map((r) => r.placeId));
    const cutoff =
      progress.ranked.length === 5
        ? progress.ranked[4].metres + 2000
        : Infinity;
    const next = candidates
      .filter(
        (p) =>
          !known.has(p.id) &&
          !attempted.has(p.id) &&
          haversine(home, p) <= cutoff,
      )
      .slice(0, 25);
    if (!next.length) break;
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
        "The free routing service is unavailable. Previously saved distances are unchanged; try again later.",
      );
    if (!data.sources?.[0] || data.sources[0].distance > 1000)
      throw new Error(
        "Home is too far from a routable road. Check your starting coordinates.",
      );
    if (store.get("settings", "home")?.version !== home.version)
      throw new Error(
        "Home changed while routes were being calculated. Please retry.",
      );
    next.forEach((p, index) => {
      attempted.add(p.id);
      const metres = data.distances?.[0]?.[index + 1],
        seconds = data.durations?.[0]?.[index + 1],
        destination = data.destinations?.[index + 1];
      if (
        !Number.isFinite(metres) ||
        !Number.isFinite(seconds) ||
        !destination ||
        destination.distance > 1000
      ) {
        unavailable++;
        return;
      }
      store.put("routes", p.id, {
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
  }
  return {
    calculated,
    unavailable,
    ...outward(places, store.list("visits"), home, available()),
  };
}

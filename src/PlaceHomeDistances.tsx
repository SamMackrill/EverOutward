import { placeMatchesHome } from "../server/home-destinations.mjs";
import { miles } from "./format";
import type { HomeJourney, Place } from "./types";

/** Distances and full unvisited-list positions for every available home. */
export default function PlaceHomeDistances({
  place,
  journeys,
}: {
  place: Place;
  journeys: HomeJourney[];
}) {
  const distances = journeys
    .filter((home) => placeMatchesHome(place, home))
    .map((home) => {
      const destination = home.destinations?.find(
        (entry) => entry.placeId === place.id,
      );
      // Older public snapshots include only the next five. Preserve their
      // saved ranks; rounded public centres must never determine the order.
      const queueIndex = home.queue.findIndex(
        (entry) => entry.placeId === place.id,
      );
      const entry = destination || home.queue[queueIndex];
      const position =
        destination?.position ?? (queueIndex >= 0 ? queueIndex + 1 : undefined);
      const route =
        typeof entry?.metres === "number"
          ? entry
          : home.reviewedRoutes?.find((r) => r.placeId === place.id);
      return { home, position, route };
    })
    .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity));
  if (!distances.length) return null;
  return (
    <ul
      className="place-home-distances"
      aria-label="Distances and next to visit positions"
    >
      {distances.map(({ home, position, route }) => {
        return (
          <li className="place-home-distance" key={home.id}>
            <span className="place-home-name" title={home.label}>
              <span
                className="home-colour"
                style={{ background: home.colour }}
                aria-hidden="true"
              />
              <span className="place-home-label">{home.label}</span>
            </span>
            <span
              className="place-home-position"
              aria-label={
                position
                  ? `Number ${position} next to visit`
                  : "Position not published yet"
              }
              title={
                position
                  ? "Next to visit position"
                  : "Position not published yet"
              }
            >
              {position ? `#${position}` : "—"}
            </span>
            <span
              className="place-home-road-distance"
              aria-label={route ? undefined : "Road distance not saved"}
            >
              {route ? `≈ ${miles(route.metres!)} mi by road` : "Not saved"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

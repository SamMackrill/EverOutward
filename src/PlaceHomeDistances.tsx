import { Compass, Route as RouteIcon } from "lucide-react";
import { haversine } from "../server/domain.mjs";
import { duration, miles } from "./format";
import { WalkingEstimate } from "./shared";
import type { HomeJourney, Place } from "./types";

/** Distances and full unvisited-list positions for every available home. */
export default function PlaceHomeDistances({
  place,
  journeys,
}: {
  place: Place;
  journeys: HomeJourney[];
}) {
  if (!journeys.length) return null;
  return (
    <section
      className="place-home-distances"
      aria-label="Distances and next to visit positions"
    >
      {journeys.map((home) => {
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
          destination?.position ??
          (queueIndex >= 0 ? queueIndex + 1 : undefined);
        const geographicMetres =
          entry?.geographicMetres ?? haversine(home.range.centre, place);
        const approximate =
          entry?.geographicApproximate ?? home.range.approximate;
        const route =
          typeof entry?.metres === "number" &&
          typeof entry?.seconds === "number"
            ? entry
            : home.reviewedRoutes?.find((r) => r.placeId === place.id);
        return (
          <article className="place-home-distance" key={home.id}>
            <div className="place-home-distance-heading">
              <h3>
                <span
                  className="home-colour"
                  style={{ background: home.colour }}
                  aria-hidden="true"
                />
                {home.label}
              </h3>
              <span className="place-home-position">
                {position
                  ? `No. ${position} next to visit`
                  : "Position not published yet"}
              </span>
            </div>
            <div className="info-row">
              <Compass size={18} aria-hidden="true" />
              <span>
                {approximate ? "≈" : ""}
                {miles(geographicMetres)} mi straight line
                {approximate && (
                  <small>
                    Approximate public distance; position uses the saved home
                    order.
                  </small>
                )}
              </span>
            </div>
            <div className="info-row">
              <RouteIcon size={18} aria-hidden="true" />
              <span>
                {route
                  ? `${miles(route.metres!)} mi by road · ${duration(route.seconds!)}`
                  : "Driving distance and time not saved yet"}
              </span>
            </div>
            <WalkingEstimate route={route} detail />
          </article>
        );
      })}
    </section>
  );
}

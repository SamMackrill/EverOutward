import { hasLimitedAccess } from "./access-rules.mjs";

export function haversine(a, b) {
  const rad = (value) => (value * Math.PI) / 180;
  const lat = rad(b.lat - a.lat),
    lng = rad(b.lng - a.lng);
  const h =
    Math.sin(lat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(lng / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function routeMatchesPlace(route, place) {
  return (
    !route.reviewRequired &&
    (route.destinationVersion || "catalogue") ===
      (place?.entrance?.version || "catalogue")
  );
}
export const isReviewedRoute = (route) =>
  !!route?.reviewed || /^Owner-(entered|verified)/.test(route?.source || "");
export function outward(places, visits, home, routes = []) {
  const byId = new Map(places.map((p) => [p.id, p]));
  const visited = new Set(visits.map((v) => v.placeId));
  const routeMap = new Map(
    routes
      .filter(
        (r) =>
          r.homeVersion === home?.version &&
          (!home?.id || r.homeId === home.id) &&
          routeMatchesPlace(r, byId.get(r.placeId)),
      )
      .map((r) => [r.placeId, r]),
  );
  const candidates = places.filter((p) => !visited.has(p.id));
  // Challenge order and circle boundaries use the same catalogue point.
  // Corrected road entrances and saved routes affect travel advice only.
  const ranked = home
    ? candidates
        .map((p) => ({
          ...p,
          ...routeMap.get(p.id),
          placeId: p.id,
          geographicMetres: haversine(home, p),
        }))
        .sort(
          (a, b) =>
            a.geographicMetres - b.geographicMetres || a.id.localeCompare(b.id),
        )
    : [];
  const pending = candidates.filter((p) => !routeMap.has(p.id));
  const blockingPendingCount = 0;
  const complete = !!home;
  const regularRanked = ranked.filter((p) => !hasLimitedAccess(p));
  const rangeRemainingCount = candidates.filter(
    (p) => !hasLimitedAccess(p),
  ).length;
  const rangeCandidates = regularRanked.length ? [regularRanked[0]] : [];
  const circle = confirmedVisitRange(
    places,
    visits,
    home,
    rangeCandidates,
    rangeRemainingCount === 0,
  );
  return {
    ranked: ranked.slice(0, 5),
    allRanked: ranked,
    pendingCount: pending.length,
    blockingPendingCount,
    complete,
    visitedCount: visited.size,
    remainingCount: candidates.length,
    rangeRemainingCount,
    radius: circle.radius,
    rangeComplete: circle.confirmed,
    rangeCandidates,
    maxRoad: Math.max(
      0,
      ...routes
        .filter(
          (r) =>
            r.homeVersion === home?.version &&
            (!home?.id || r.homeId === home.id) &&
            visited.has(r.placeId) &&
            routeMatchesPlace(r, byId.get(r.placeId)),
        )
        .map((r) => r.metres),
    ),
  };
}

// A geographic circle, bounded by the nearest unvisited ordinary-access place.
// Out-of-order visits beyond that boundary do not expand local progress.
export function visitRange(places, visits, centre, next, allVisited = false) {
  if (!centre || (!next && !allVisited)) return 0;
  const boundary = next ? haversine(centre, next) : Infinity;
  const visited = new Set(visits.map((v) => v.placeId));
  return Math.max(
    0,
    ...places
      .filter((p) => visited.has(p.id))
      .map((p) => haversine(centre, p))
      .filter((distance) => distance < boundary),
  );
}

function confirmedVisitRange(places, visits, centre, candidates, allVisited) {
  if (!centre || (!allVisited && !candidates.length))
    return { radius: 0, confirmed: false };
  if (allVisited)
    return {
      radius: visitRange(places, visits, centre, null, true),
      confirmed: true,
    };
  const radius = visitRange(places, visits, centre, candidates[0]);
  const confirmed = candidates.every(
    (candidate) => visitRange(places, visits, centre, candidate) === radius,
  );
  return { radius: confirmed ? radius : 0, confirmed };
}

export function publicRange(places, visits, home, journey) {
  if (!home) return null;
  const centre = {
    lat: Math.round(home.lat * 10) / 10,
    lng: Math.round(home.lng * 10) / 10,
  };
  const circle = confirmedVisitRange(
    places,
    visits,
    centre,
    journey.rangeCandidates ||
      (journey.complete && journey.ranked[0] ? [journey.ranked[0]] : []),
    (journey.rangeRemainingCount ?? journey.remainingCount) === 0,
  );
  return {
    centre,
    radius: circle.radius,
    confirmed: circle.confirmed,
    approximate: true,
  };
}

export function sortVisits(visits) {
  return [...visits].sort(
    (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id),
  );
}
export function publicVisit(visit, homes = []) {
  const {
    id,
    placeId,
    date,
    title,
    summary,
    notes,
    attendees = [],
    rating,
    photos,
    coverId,
    published,
    createdAt,
    updatedAt,
    startingHomeSnapshot,
  } = visit;
  return {
    id,
    placeId,
    date,
    title,
    summary,
    notes,
    attendees,
    rating,
    photos,
    coverId,
    published,
    createdAt,
    updatedAt,
    startingHomeLabel:
      homes.find((home) => home.id === visit.startingHomeId)?.label ||
      startingHomeSnapshot?.label ||
      null,
  };
}
export function wazeLink(place) {
  const destination = place.entrance || place;
  return `https://waze.com/ul?ll=${destination.lat},${destination.lng}&navigate=yes&utm_source=everoutward`;
}

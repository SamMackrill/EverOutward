export function haversine(a, b) {
  const rad = (value) => (value * Math.PI) / 180;
  const lat = rad(b.lat - a.lat),
    lng = rad(b.lng - a.lng);
  const h =
    Math.sin(lat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(lng / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function outward(places, visits, home, routes = []) {
  const visited = new Set(visits.map((v) => v.placeId));
  const routeMap = new Map(
    routes
      .filter(
        (r) =>
          r.homeVersion === home?.version &&
          (!home?.id || r.homeId === home.id),
      )
      .map((r) => [r.placeId, r]),
  );
  const candidates = places.filter((p) => !visited.has(p.id));
  const ranked = candidates
    .filter((p) => routeMap.has(p.id))
    .map((p) => ({ ...p, ...routeMap.get(p.id) }))
    .sort((a, b) => a.metres - b.metres || a.id.localeCompare(b.id));
  const pending = candidates.filter((p) => !routeMap.has(p.id));
  // An unrouted place cannot displace the fifth route when even its geographic
  // lower bound is longer. Allow 1 km of road snapping at each endpoint.
  const cutoff = ranked.length >= 5 ? ranked[4].metres : Infinity;
  const blockingPendingCount = home
    ? pending.filter((p) => haversine(home, p) - 2000 <= cutoff).length
    : pending.length;
  const complete = !!home && !blockingPendingCount;
  // Circle certainty is separate from certainty about the full next-five order.
  // Every unrouted place that could beat the first known road route is a possible
  // next gate. A circle is safe when all those gates give the same visited extent.
  const rangeCandidates =
    home && ranked.length
      ? [
          ranked[0],
          ...pending.filter(
            (p) => haversine(home, p) - 2000 <= ranked[0].metres,
          ),
        ]
      : [];
  const circle = confirmedVisitRange(
    places,
    visits,
    home,
    rangeCandidates,
    candidates.length === 0,
  );
  return {
    ranked: ranked.slice(0, 5),
    pendingCount: pending.length,
    blockingPendingCount,
    complete,
    visitedCount: visited.size,
    remainingCount: candidates.length,
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
            visited.has(r.placeId),
        )
        .map((r) => r.metres),
    ),
  };
}

// A geographic circle, bounded by the next destination selected by road.
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
    journey.remainingCount === 0,
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
  return `https://waze.com/ul?ll=${place.lat},${place.lng}&navigate=yes&utm_source=everoutward`;
}

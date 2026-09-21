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
      .filter((r) => r.homeVersion === home?.version)
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
  return {
    ranked: ranked.slice(0, 5),
    pendingCount: pending.length,
    blockingPendingCount,
    complete,
    visitedCount: visited.size,
    remainingCount: candidates.length,
    radius: visitRange(
      places,
      visits,
      home,
      complete ? ranked[0] : null,
      candidates.length === 0,
    ),
    maxRoad: Math.max(
      0,
      ...routes
        .filter(
          (r) => r.homeVersion === home?.version && visited.has(r.placeId),
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

export function publicRange(places, visits, home, journey) {
  if (!home) return null;
  const centre = {
    lat: Math.round(home.lat * 10) / 10,
    lng: Math.round(home.lng * 10) / 10,
  };
  return {
    centre,
    radius: visitRange(
      places,
      visits,
      centre,
      journey.complete ? journey.ranked[0] : null,
      journey.remainingCount === 0,
    ),
    approximate: true,
  };
}

export function sortVisits(visits) {
  return [...visits].sort(
    (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id),
  );
}
export function publicVisit(visit) {
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
  };
}
export function wazeLink(place) {
  return `https://waze.com/ul?ll=${place.lat},${place.lng}&navigate=yes&utm_source=everoutward`;
}

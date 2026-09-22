import { createHash, randomUUID } from "node:crypto";
import { routeKey } from "./homes.mjs";
import { routeMatchesPlace, isReviewedRoute } from "./domain.mjs";
import { boatAccess } from "./access-rules.mjs";

export function applyPlaceCorrections(places, corrections = []) {
  const byId = new Map(corrections.map((c) => [c.placeId, c]));
  return places.map((p) => {
    if (boatAccess[p.id]) p = { ...p, boatRequired: true, accessNote: boatAccess[p.id].note };
    const c = byId.get(p.id);
    return c
      ? {
          ...p,
          entrance: { ...c.entrance, version: c.version },
          entranceVerified: true,
          accessNote: c.publicNote || p.accessNote || "",
        }
      : p;
  });
}
export function publicPlaceOverrides(corrections) {
  return corrections.map((c) => ({
    id: c.placeId,
    entrance: { ...c.entrance, version: c.version },
    entranceVerified: true,
    accessNote: c.publicNote || "",
  }));
}
export function reviewRevision(store, home, place) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        store.get("routes", routeKey(home, place.id)),
        store.get("routeReviews", routeKey(home, place.id)),
        place.entrance || null,
      ]),
    )
    .digest("hex");
}
export function distanceReviewRows(store, home, places) {
  const routes = new Map(
    store
      .list("routes")
      .filter((r) => r.homeId === home.id && r.homeVersion === home.version)
      .map((r) => [r.placeId, r]),
  );
  const reviews = new Map(
    store
      .list("routeReviews")
      .filter((r) => r.homeId === home.id && r.homeVersion === home.version)
      .map((r) => [r.placeId, r]),
  );
  const failures = new Map(
    (
      store.get("routeReports", JSON.stringify([home.id, home.version]))
        ?.unavailablePlaces || []
    ).map((r) => [r.placeId, r]),
  );
  return places.map((place) => {
    const route = routes.get(place.id),
      review = reviews.get(place.id),
      failure = failures.get(place.id);
    const valid = route && routeMatchesPlace(route, place);
    const needsReview =
      !!review?.open || (!!route && !valid) || (!valid && !!failure);
    return {
      placeId: place.id,
      name: place.name,
      route: route || null,
      revision: reviewRevision(store, home, place),
      status: needsReview
        ? "needs-review"
        : valid
          ? isReviewedRoute(route)
            ? "resolved"
            : "saved"
          : "missing",
      reason: review?.open
        ? review.reason
        : !valid
          ? place.entrance && route
            ? "The entrance changed. Recalculate this home’s route."
            : failure?.reason || "No driving distance saved for this home."
          : "",
      reviewNote: review?.note || "",
      entranceSourceUrl:
        store.get("placeCorrections", place.id)?.sourceUrl || "",
      reviewedAt: isReviewedRoute(route) ? route.checkedAt : null,
    };
  });
}
export function saveReviewedRoute(store, home, place, data) {
  const key = routeKey(home, place.id),
    previous = store.get("routes", key);
  if (previous)
    store.put("routeHistory", randomUUID(), {
      ...previous,
      replacedAt: new Date().toISOString(),
    });
  const route = {
    homeId: home.id,
    homeVersion: home.version,
    placeId: place.id,
    destinationVersion: place.entrance?.version || "catalogue",
    metres: data.metres,
    seconds: data.seconds,
    source: data.source || "Owner-verified driving route",
    reviewed: true,
    checkedAt: new Date().toISOString(),
  };
  store.put("routes", key, route);
  store.put("routeReviews", key, {
    homeId: home.id,
    homeVersion: home.version,
    placeId: place.id,
    open: false,
    note: data.note || "",
    updatedAt: route.checkedAt,
  });
  return route;
}

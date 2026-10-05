/** Ardglass is a separate challenge because mainland trips cross the Irish Sea. */
export function homeDestinationScope(home) {
  return /\bardglass\b/i.test(home?.label || "")
    ? "northern-ireland"
    : "great-britain";
}

export function placeMatchesHome(place, home) {
  if (!home) return true;
  const scope = home.destinationScope || homeDestinationScope(home);
  return (
    (place.region === "Northern Ireland") === (scope === "northern-ireland")
  );
}

export function placesForHome(places, home) {
  return places.filter((place) => placeMatchesHome(place, home));
}

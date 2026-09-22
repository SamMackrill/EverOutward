import details from "../scripts/place-details.json";
import type { Place } from "./types";
import { boatAccess } from "../server/access-rules.mjs";

// Bundle reviewed details and fingerprinted photographs with each app release.
// A cached catalogue must not replace newly supplied photos with empty fields.
const photos: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>("./assets/destinations/*.jpg", {
      eager: true,
      query: "?url",
      import: "default",
    }),
  ).map(([path, url]) => [`/photos/${path.split("/").at(-1)}`, url]),
);
export function enrichCatalogue(places: Place[]): Place[] {
  return places.map((place) => {
    const current = {
      ...place,
      ...(details as Record<string, Partial<Place>>)[place.id],
      ...(boatAccess[place.id]
        ? {
            boatRequired: true,
            accessNote: place.accessNote || boatAccess[place.id].note,
          }
        : {}),
    };
    return { ...current, image: photos[current.image] || current.image };
  });
}

import details from "../scripts/place-details.json";
import ramsey from "./assets/destinations/ramsey.jpg";
import willington from "./assets/destinations/willington.jpg";
import hatfield from "./assets/destinations/hatfield.jpg";
import ickworth from "./assets/destinations/ickworth.jpg";
import theatre from "./assets/destinations/theatre-royal.jpg";
import type { Place } from "./types";

// Bundle reviewed details and fingerprinted photographs with each app release.
// A cached catalogue must not replace newly supplied photos with empty fields.
const photos: Record<string, string> = {
  "/photos/ramsey.jpg": ramsey,
  "/photos/willington.jpg": willington,
  "/photos/hatfield.jpg": hatfield,
  "/photos/ickworth.jpg": ickworth,
  "/photos/theatre-royal.jpg": theatre,
};
export function enrichCatalogue(places: Place[]): Place[] {
  return places.map((place) => {
    const current = {
      ...place,
      ...(details as Record<string, Partial<Place>>)[place.id],
    };
    return { ...current, image: photos[current.image] || current.image };
  });
}

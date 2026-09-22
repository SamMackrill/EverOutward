import { existsSync, readFileSync } from "node:fs";
import { applyPlaceCorrections } from "../server/distance-review.mjs";
import { routeMatchesPlace } from "../server/domain.mjs";
import { createStore } from "../server/store.mjs";
import {
  currentHome,
  homeRoutes,
  liveHomes,
  migrateHomes,
} from "../server/homes.mjs";
if (!existsSync(".local/everoutward.sqlite"))
  throw new Error("Set up a home in Workspace first.");
const store = createStore(".local/everoutward.sqlite");
try {
  migrateHomes(store);
  const places = applyPlaceCorrections(
    JSON.parse(readFileSync("public/data/places.json", "utf8")).places,
    store.list("placeCorrections"),
  );
  console.log(
    JSON.stringify(
      liveHomes(store).map((h) => ({
        id: h.id,
        name: h.label,
        current: currentHome(store)?.id === h.id,
        version: h.version,
        savedDistances: homeRoutes(store, h).filter((r) =>
          places.some((p) => p.id === r.placeId && routeMatchesPlace(r, p)),
        ).length,
      })),
      null,
      2,
    ),
  );
} finally {
  store.close();
}

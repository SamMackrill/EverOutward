import { existsSync } from "node:fs";
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
  console.log(
    JSON.stringify(
      liveHomes(store).map((h) => ({
        id: h.id,
        name: h.label,
        current: currentHome(store)?.id === h.id,
        version: h.version,
        savedDistances: homeRoutes(store, h).length,
      })),
      null,
      2,
    ),
  );
} finally {
  store.close();
}

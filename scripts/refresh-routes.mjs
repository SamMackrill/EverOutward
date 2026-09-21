import { readFile } from "node:fs/promises";
import { createStore } from "../server/store.mjs";
import { refreshDrivingRoutes } from "../server/routing.mjs";
const store = createStore(".local/everoutward.sqlite");
try {
  const { places } = JSON.parse(
    await readFile("public/data/places.json", "utf8"),
  );
  const result = await refreshDrivingRoutes({ store, places });
  console.log(
    JSON.stringify(
      {
        calculated: result.calculated,
        complete: result.complete,
        blocking: result.blockingPendingCount,
        next: result.ranked.map((p) => ({
          id: p.id,
          name: p.name,
          miles: +(p.metres / 1609.344).toFixed(1),
          minutes: Math.round(p.seconds / 60),
        })),
      },
      null,
      2,
    ),
  );
} finally {
  store.close();
}

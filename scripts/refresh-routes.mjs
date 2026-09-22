import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createStore } from "../server/store.mjs";
import { refreshDrivingRoutes } from "../server/routing.mjs";
import { currentHome, liveHomes, migrateHomes } from "../server/homes.mjs";
import { applyPlaceCorrections } from "../server/distance-review.mjs";
import { createPublishJobs } from "../server/publish-jobs.mjs";
const args = process.argv.slice(2);
let homeId,
  all = false,
  force = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--home" && args[i + 1] && !args[i + 1].startsWith("--"))
    homeId = args[++i];
  else if (args[i] === "--all-homes") all = true;
  else if (args[i] === "--force") force = true;
  else
    throw new Error(
      "Usage: npm run routes:refresh -- [--home ID | --all-homes] [--force]",
    );
}
if (homeId && all) throw new Error("Choose --home or --all-homes, not both.");
const databasePath = ".local/everoutward.sqlite";
if (!existsSync(databasePath))
  throw new Error("Set up your home in Workspace first.");
const store = createStore(databasePath);
const routesBefore = JSON.stringify(store.list("routes"));
try {
  migrateHomes(store);
  const homes = all
    ? liveHomes(store)
    : [homeId ? store.get("homes", homeId) : currentHome(store)];
  if (!homes.length || homes.some((h) => !h || h.archivedAt))
    throw new Error("Choose an available home. Run npm run homes:list.");
  const { places } = JSON.parse(
    await readFile("public/data/places.json", "utf8"),
  );
  const backupPath = ".local/backups/before-routes-" + Date.now() + ".sqlite";
  store.backup(backupPath);
  console.log("Private journal backup: " + backupPath);
  await mkdir(".local/route-reports", { recursive: true });
  for (const home of homes) {
    console.log("Calculating from " + home.label + " (" + home.id + ").");
    const result = await refreshDrivingRoutes({
      store,
      places: applyPlaceCorrections(places, store.list("placeCorrections")),
      homeId: home.id,
      force,
      onProgress: ({ processed, requested, calculated, unavailable }) =>
        console.log(
          processed +
            "/" +
            requested +
            " checked; " +
            calculated +
            " saved; " +
            unavailable +
            " need review.",
        ),
    });
    const report = { ...result, checkedAt: new Date().toISOString() };
    const path = ".local/route-reports/" + home.id + ".json";
    await writeFile(path, JSON.stringify(report, null, 2));
    console.log(
      JSON.stringify(
        {
          homeId: home.id,
          label: home.label,
          saved: result.saved,
          total: result.total,
          remaining: result.remaining,
          nextFiveConfirmed: result.complete,
          unavailablePlaces: result.unavailablePlaces,
          report: path,
        },
        null,
        2,
      ),
    );
  }
} finally {
  if (JSON.stringify(store.list("routes")) !== routesBefore) {
    const job = createPublishJobs({ store }).enqueue();
    console.log(
      "Updated distances saved; website publish queued (" + job.id + ").",
    );
  }
  store.close();
}

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createStore } from "../server/store.mjs";
import { refreshDrivingRoutes } from "../server/routing.mjs";
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--force"))
  throw new Error("Usage: npm run routes:refresh -- [--force]");
const databasePath = ".local/everoutward.sqlite";
if (!existsSync(databasePath))
  throw new Error(
    "The local journal is missing. Set up your home in Workspace first.",
  );
const store = createStore(databasePath);
try {
  const { places } = JSON.parse(
    await readFile("public/data/places.json", "utf8"),
  );
  const backupPath = `.local/backups/before-routes-${new Date().toISOString().replaceAll(":", "-")}.sqlite`;
  store.backup(backupPath);
  console.log(`Private journal backup saved to ${backupPath}.`);
  const result = await refreshDrivingRoutes({
    store,
    places,
    force: args.includes("--force"),
    onProgress: ({ processed, requested, calculated, unavailable }) => {
      console.log(
        `${processed}/${requested} places checked; ${calculated} distances saved; ${unavailable} need review.`,
      );
    },
  });
  const report = { ...result, checkedAt: new Date().toISOString() };
  // Keep the detailed review list with the private journal, outside Git/publishing.
  await writeFile(".local/routes-report.json", JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        calculated: result.calculated,
        saved: result.saved,
        total: result.total,
        remaining: result.remaining,
        catalogueComplete: result.catalogueComplete,
        unavailablePlaces: result.unavailablePlaces,
        nextFiveConfirmed: result.complete,
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
  console.log("Route report saved to .local/routes-report.json.");
} finally {
  store.close();
}

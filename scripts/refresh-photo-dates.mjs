import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createPreviewStore, createStore } from "../server/store.mjs";
import { refreshPhotoDates } from "../server/photo-date-refresh.mjs";

const write = process.argv.includes("--write");
const database = resolve(
  process.argv.find((arg) => arg.startsWith("--database="))?.slice(11) ||
    ".local/everoutward.sqlite",
);
if (!existsSync(database))
  throw new Error(
    "The saved journal database is missing. Run this from the owner checkout.",
  );
const store = write ? createStore(database) : createPreviewStore(database);
try {
  const result = await refreshPhotoDates(store, {
    write,
    progress: console.log,
  });
  console.log(
    JSON.stringify(
      {
        ...result,
        failures: result.failures.map(({ message }) => ({ message })),
      },
      null,
      2,
    ),
  );
  if (!write)
    console.log(
      "Dry run: the saved journal was not changed. Use --write to back up and save recovered dates.",
    );
  if (result.failures.length) process.exitCode = 1;
} finally {
  store.close();
}

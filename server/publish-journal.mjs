import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createStore } from "./store.mjs";

export function journalSnapshot(store) {
  const rows = store.snapshot();
  const records = rows.filter(
    (row) =>
      row.kind === "visits" ||
      row.kind === "routes" ||
      (row.kind === "settings" && row.id === "home"),
  );
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(records))
    .digest("hex");
  return {
    fingerprint,
    visits: records
      .filter((r) => r.kind === "visits")
      .map((r) => JSON.parse(r.payload)),
    routes: records
      .filter((r) => r.kind === "routes")
      .map((r) => JSON.parse(r.payload)),
    home: JSON.parse(
      records.find((r) => r.kind === "settings" && r.id === "home")?.payload ||
        "null",
    ),
  };
}
export function requireJournal(path) {
  if (!existsSync(path))
    throw new Error(
      "The local journal database is missing. Publication stopped to protect the live journal. Restore your database backup first.",
    );
  return createStore(path);
}
export function assertJournalUnchanged(path, expected) {
  const store = requireJournal(path);
  try {
    if (journalSnapshot(store).fingerprint !== expected)
      throw new Error(
        "The journal changed during publication. Your latest edits are saved locally; publish again to include them. The staged upload was not made live.",
      );
  } finally {
    store.close();
  }
}

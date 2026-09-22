import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function createStore(filename) {
  if (filename !== ":memory:")
    mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(kind,id));",
  );
  return {
    filename,
    transaction: (fn) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = fn();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    snapshot: () =>
      db.prepare("SELECT kind,id,payload FROM records ORDER BY kind,id").all(),
    backup: (destination) => {
      mkdirSync(dirname(destination), { recursive: true });
      db.prepare("VACUUM INTO ?").run(destination);
    },
    list: (kind) =>
      db
        .prepare("SELECT payload FROM records WHERE kind=?")
        .all(kind)
        .map((r) => JSON.parse(r.payload)),
    get: (kind, id) => {
      const row = db
        .prepare("SELECT payload FROM records WHERE kind=? AND id=?")
        .get(kind, id);
      return row ? JSON.parse(row.payload) : null;
    },
    put: (kind, id, payload) =>
      db
        .prepare(
          "INSERT INTO records(kind,id,payload) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET payload=excluded.payload",
        )
        .run(kind, id, JSON.stringify(payload)),
    delete: (kind, id) =>
      db.prepare("DELETE FROM records WHERE kind=? AND id=?").run(kind, id),
    close: () => db.close(),
  };
}

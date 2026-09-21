import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../server/store.mjs";
import {
  journalSnapshot,
  requireJournal,
  assertJournalUnchanged,
} from "../server/publish-journal.mjs";

test("deployment backup preserves notes and display photos; concurrent edits cancel stale publication", () => {
  const folder = mkdtempSync(join(tmpdir(), "everoutward-persistence-"));
  const path = join(folder, "journal.sqlite"),
    backup = join(folder, "before-publish.sqlite");
  const store = createStore(path);
  try {
    const visit = {
      id: "v1",
      notes: "Recently written notes",
      photos: [
        {
          url: "https://photos.app.goo.gl/example",
          previewUrl: "data:image/jpeg;base64,/9j/AA==",
        },
      ],
    };
    store.put("visits", visit.id, visit);
    store.backup(backup);
    const captured = journalSnapshot(store);
    assertJournalUnchanged(path, captured.fingerprint);
    store.put("comments", "c1", { body: "New comment" });
    assertJournalUnchanged(path, captured.fingerprint);
    store.put("visits", visit.id, { ...visit, notes: "Edited during upload" });
    assert.throws(
      () => assertJournalUnchanged(path, captured.fingerprint),
      /changed during publication/,
    );
    assert.equal(store.get("visits", "v1").notes, "Edited during upload");
    const restored = requireJournal(backup);
    try {
      assert.deepEqual(restored.get("visits", "v1"), visit);
    } finally {
      restored.close();
    }
    assert.throws(
      () => requireJournal(join(folder, "missing.sqlite")),
      /missing/,
    );
  } finally {
    store.close();
  }
});

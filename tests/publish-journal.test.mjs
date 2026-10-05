import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, createPreviewStore } from "../server/store.mjs";
import { accessEntries } from "../server/access-dates.mjs";
import {
  journalSnapshot,
  requireJournal,
  assertJournalUnchanged,
  withSiteUrl,
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

test("link preview images become absolute once the site address is known", () => {
  const html =
    '<meta property="og:image" content="/icons/gate-1024.png" /><meta property="og:title" content="/not-a-url" />';
  assert.equal(withSiteUrl(html, undefined), html);
  assert.equal(
    withSiteUrl(html, "https://quartz-oyster-7zxz.here.now/"),
    '<meta property="og:image" content="https://quartz-oyster-7zxz.here.now/icons/gate-1024.png" /><meta property="og:title" content="/not-a-url" />',
  );
});

test("temporary preview copies preserve the saved journal and discard their edits on restart", () => {
  const folder = mkdtempSync(join(tmpdir(), "everoutward-preview-"));
  const path = join(folder, "journal.sqlite");
  const original = createStore(path);
  let preview;
  try {
    const visit = {
      id: "visit",
      notes: "Permanent notes",
      photos: [{ url: "saved-photo" }],
    };
    original.put("visits", visit.id, visit);
    const before = original.snapshot();
    preview = createPreviewStore(path);
    assert.equal(preview.filename, ":memory:");
    assert.deepEqual(preview.get("visits", visit.id), visit);
    preview.put("visits", visit.id, { ...visit, notes: "Preview edit" });
    preview.put("settings", "temporary", { value: true });
    assert.deepEqual(original.snapshot(), before);
    preview.close();
    preview = createPreviewStore(path);
    assert.deepEqual(preview.get("visits", visit.id), visit);
    assert.equal(preview.get("settings", "temporary"), null);
  } finally {
    preview?.close();
    original.close();
  }
});

test("calendar polling cannot invalidate publication, while unread-date changes still do", () => {
  const folder = mkdtempSync(join(tmpdir(), "everoutward-access-publish-"));
  const path = join(folder, "journal.sqlite");
  const store = createStore(path);
  const placeId = "207a7c87-e721-49cf-a5a9-f9d14cb7c821";
  const places = [{ id: placeId }];
  const now = new Date("2026-10-05T12:00:00Z");
  try {
    const saved = {
      placeId,
      dates: [{ date: "2099-11-01", hours: "14:00–17:00" }],
      newDates: ["2099-11-01"],
      seenDates: ["private-tracking"],
      checkedAt: "2026-10-05T12:00:00Z",
      attemptedAt: "2026-10-05T12:00:00Z",
      error: null,
    };
    store.put("accessDates", placeId, saved);
    const snapshot = journalSnapshot(store);
    store.put("accessDates", placeId, {
      ...saved,
      dates: [{ date: "2099-11-01", hours: "15:00–17:00" }],
      checkedAt: "2026-10-06T12:00:00Z",
      attemptedAt: "2026-10-07T12:00:00Z",
      error: "Offline",
    });
    assertJournalUnchanged(path, snapshot.fingerprint);
    const exported = accessEntries(snapshot.accessDates, places, { now });
    assert.equal(exported[0].checkedAt, saved.checkedAt);
    assert.equal(exported[0].dates[0].hours, "14:00–17:00");
    assert.equal(exported[0].error, null);
    assert.equal(JSON.stringify(exported).includes("private-tracking"), false);
    store.put("accessDates", placeId, { ...saved, newDates: [] });
    assert.throws(
      () => assertJournalUnchanged(path, snapshot.fingerprint),
      /changed during publication/,
    );
    const acknowledged = journalSnapshot(store);
    store.put("accessDates", placeId, { ...saved, newDates: [] });
    assertJournalUnchanged(path, acknowledged.fingerprint);
    store.put("accessDates", placeId, { ...saved, newDates: ["2099-11-08"] });
    assert.throws(
      () => assertJournalUnchanged(path, acknowledged.fingerprint),
      /changed during publication/,
    );
  } finally {
    store.close();
  }
});

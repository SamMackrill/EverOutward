import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.mjs";
import { createStore } from "../server/store.mjs";
import {
  publishedVisitHash,
  unpublishedChanges,
} from "../server/publish-journal.mjs";

const visit = (id, extra = {}) => ({
  id,
  placeId: "a",
  date: "2026-09-01",
  title: id,
  summary: "",
  notes: "",
  attendees: [],
  photos: [],
  rating: null,
  coverId: null,
  published: true,
  createdAt: "2026-09-01T12:00:00Z",
  updatedAt: "2026-09-01T12:00:00Z",
  ...extra,
});

test("unpublished changes count new, edited, withdrawn and deleted visits", () => {
  const published = visit("published"),
    edited = visit("edited"),
    withdrawn = visit("withdrawn"),
    publication = {
      visits: Object.fromEntries(
        [published, edited, withdrawn, visit("deleted")].map((v) => [
          v.id,
          publishedVisitHash(v),
        ]),
      ),
    };
  const current = [
    published,
    { ...edited, title: "Edited title" },
    { ...withdrawn, published: false },
    visit("new"),
    visit("private", { published: false }),
  ];
  assert.equal(unpublishedChanges(current, publication), 4);
  assert.equal(unpublishedChanges([published], publication), 3);
  assert.equal(unpublishedChanges(current, undefined), 3);
});

test("visits can be included or excluded together, and stale edits abort all", async (t) => {
  const store = createStore(":memory:");
  for (const id of ["one", "two"])
    store.put("visits", id, visit(id, { published: false }));
  const app = createApp({
    store,
    places: [{ id: "a", name: "A", region: "R", lat: 52, lng: 0 }],
    initialHome: { lat: 52, lng: 0, label: "Base", version: "v1" },
    enableCloud: false,
    localOwner: true,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => {
    server.close();
    store.close();
  });
  const patch = (body) =>
    fetch(`http://127.0.0.1:${server.address().port}/api/visits/publication`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-EverOutward": "1",
        Origin: "http://127.0.0.1:5173",
      },
      body: JSON.stringify(body),
    });
  const stale = await patch({
    published: true,
    visits: [
      { id: "one", updatedAt: "2026-09-01T12:00:00Z" },
      { id: "two", updatedAt: "stale" },
    ],
  });
  assert.equal(stale.status, 409);
  assert.equal(store.get("visits", "one").published, false);
  const ok = await patch({
    published: true,
    visits: ["one", "two"].map((id) => ({
      id,
      updatedAt: "2026-09-01T12:00:00Z",
    })),
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(
    store.list("visits").map((v) => v.published),
    [true, true],
  );
});

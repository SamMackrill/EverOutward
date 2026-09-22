import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.mjs";
import { createStore } from "../server/store.mjs";
import { currentHome } from "../server/homes.mjs";
import { outward, sortVisits } from "../server/domain.mjs";

const home = { lat: 52, lng: 0, label: "Private base", version: "v1" };
const places = [
  { id: "a", name: "Near on map", lat: 52.01, lng: 0 },
  { id: "b", name: "Near by road", lat: 52.02, lng: 0 },
  { id: "c", name: "Third", lat: 52.03, lng: 0 },
];
const routes = [
  { placeId: "a", metres: 9000, seconds: 800, homeVersion: "v1" },
  { placeId: "b", metres: 5000, seconds: 400, homeVersion: "v1" },
  { placeId: "c", metres: 12000, seconds: 1000, homeVersion: "v1" },
];
test("road ordering, repeat visits, deletion, incomplete routes and home changes", () => {
  assert.deepEqual(
    outward(places, [], home, routes).ranked.map((p) => p.id),
    ["b", "a", "c"],
  );
  const visits = [{ placeId: "b" }, { placeId: "b" }, { placeId: "c" }];
  const p = outward(places, visits, home, routes);
  assert.equal(p.visitedCount, 2);
  assert.equal(p.ranked[0].id, "a");
  assert.equal(p.maxRoad, 12000);
  const after = outward(places, visits.slice(0, 2), home, routes);
  assert.equal(after.radius, 0);
  assert.equal(p.radius, 0);
  assert.equal(after.visitedCount, 1);
  assert.equal(outward(places, [], home, routes.slice(0, 1)).complete, false);
  assert.equal(
    outward(places, [], { ...home, version: "v2" }, routes).ranked.length,
    0,
  );
  assert.equal(outward(places, [], home, routes).radius, 0);
  assert.equal(
    outward(
      places,
      places.map((p) => ({ placeId: p.id })),
      home,
      routes,
    ).ranked.length,
    0,
  );
});
test("history date order and stable same-day ties", () => {
  const visits = [
    { id: "a", date: "2026-03-01" },
    { id: "c", date: "2024-01-01" },
    { id: "b", date: "2026-03-01" },
  ];
  assert.deepEqual(
    sortVisits(visits).map((v) => v.id),
    ["b", "a", "c"],
  );
  assert.equal(visits[0].id, "a");
});
for (const passwordConfigured of [false, true]) {
  test(`local editing needs no login (existing password: ${passwordConfigured})`, async (t) => {
    const store = createStore(":memory:");
    if (passwordConfigured)
      store.put("settings", "owner", {
        salt: "existing",
        hash: "00".repeat(64),
      });
    const app = createApp({
      store,
      places,
      initialHome: home,
      enableCloud: false,
      localOwner: true,
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    t.after(() => {
      server.close();
      store.close();
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const session = await fetch(base + "/api/session");
    assert.deepEqual(await session.json(), {
      local: true,
      localOwner: true,
      owner: true,
      passwordConfigured,
    });
    assert.equal(session.headers.get("set-cookie"), null);
    const headers = {
      "Content-Type": "application/json",
      "X-EverOutward": "1",
      Origin: "http://127.0.0.1:5173",
    };
    const created = await fetch(base + "/api/visits", {
      method: "POST",
      headers,
      body: JSON.stringify({
        placeId: "a",
        date: "2026-09-01",
        title: "Draft without login",
        startingHomeId: currentHome(store).id,
        summary: "",
        notes: "Private notes",
        photos: [],
        rating: null,
        coverId: null,
        published: false,
      }),
    });
    assert.equal(created.status, 201);
    const state = await (await fetch(base + "/api/state")).json();
    assert.equal(state.home.label, home.label);
    assert.equal(state.home.version, home.version);
    assert.equal(state.visits[0].title, "Draft without login");
    assert.equal(state.visits[0].notes, "Private notes");
    for (const invalidHeaders of [
      { ...headers, Origin: "https://attacker.invalid" },
      { "Content-Type": "application/json", Origin: headers.Origin },
    ]) {
      const blocked = await fetch(base + "/api/home", {
        method: "PUT",
        headers: invalidHeaders,
        body: JSON.stringify({ ...home, label: "Unwanted change" }),
      });
      assert.equal(blocked.status, 403);
    }
    assert.equal(currentHome(store).label, home.label);
    assert.equal(currentHome(store).version, home.version);
    assert.equal(!!store.get("settings", "owner"), passwordConfigured);
  });
}

test("owner access, draft privacy, validation, comments, conflicts and route invalidation", async (t) => {
  const store = createStore(":memory:");
  const app = createApp({
    store,
    places,
    initialHome: home,
    enableCloud: false,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => {
    server.close();
    store.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = "";
  async function call(
    path,
    method = "GET",
    body,
    owner = true,
    origin = "http://127.0.0.1:5173",
  ) {
    const response = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-EverOutward": "1",
        Origin: origin,
        ...(owner && cookie ? { Cookie: cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get("set-cookie"),
    };
  }
  assert.equal((await call("/api/home", "PUT", home)).status, 401);
  assert.equal(
    (
      await call(
        "/api/login",
        "POST",
        { password: "test-only-password" },
        false,
        "https://attacker.invalid",
      )
    ).status,
    403,
  );
  const login = await call("/api/login", "POST", {
    password: "test-only-password",
  });
  assert.equal(login.status, 200);
  cookie = login.cookie.split(";")[0];
  const draft = {
    startingHomeId: currentHome(store).id,
    placeId: "a",
    date: "2026-09-01",
    title: "Private draft",
    summary: "A day out",
    notes: "<script>plain text</script>",
    photos: [
      {
        id: "photo-a",
        url: "https://example.com/photo.jpg",
        caption: "Gate",
        kind: "image",
      },
    ],
    rating: 5,
    coverId: "photo-a",
    published: false,
  };
  assert.equal(
    (await call("/api/visits", "POST", { ...draft, coverId: "foreign-photo" }))
      .status,
    400,
  );
  assert.equal(
    (await call("/api/visits", "POST", { ...draft, date: "2026-02-31" }))
      .status,
    400,
  );
  const created = await call("/api/visits", "POST", draft);
  assert.equal(created.status, 201);
  const visit = created.data.visit;
  const guest = await call("/api/state", "GET", null, false);
  assert.equal(guest.data.home, null);
  assert.equal(guest.data.routes.length, 0);
  assert.equal(guest.data.visits.length, 0);
  assert.equal(
    (
      await call(
        "/api/comments",
        "POST",
        { visitId: visit.id, photoId: null, name: "Sam", body: "Hello" },
        false,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await call("/api/visits/" + visit.id, "PUT", {
        ...draft,
        published: true,
        updatedAt: "stale",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call("/api/visits/" + visit.id, "PUT", {
        ...draft,
        published: true,
        updatedAt: visit.updatedAt,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        "/api/comments",
        "POST",
        { visitId: visit.id, photoId: null, name: "   ", body: "Hi" },
        false,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        "/api/comments",
        "POST",
        { visitId: visit.id, photoId: "other", name: "Guest", body: "Hi" },
        false,
      )
    ).status,
    404,
  );
  const comment = await call(
    "/api/comments",
    "POST",
    {
      visitId: visit.id,
      photoId: "photo-a",
      name: "Guest",
      body: "<img onerror=alert(1)>",
    },
    false,
  );
  assert.equal(comment.status, 201);
  const list = await call("/api/comments/" + visit.id, "GET", null, false);
  assert.equal(list.data.comments.length, 1);
  assert.equal(list.data.comments[0].body, "<img onerror=alert(1)>");
  assert.equal(
    (
      await call(
        "/api/comments/" + comment.data.comment.id,
        "DELETE",
        null,
        false,
      )
    ).status,
    401,
  );
  assert.equal(
    (await call("/api/comments/" + comment.data.comment.id, "DELETE")).status,
    200,
  );
  await call("/api/routes", "PUT", { routes });
  assert.equal((await call("/api/state")).data.routes.length, 3);
  await call("/api/home", "PUT", {
    label: "Renamed base",
    lat: home.lat,
    lng: home.lng,
  });
  assert.equal((await call("/api/state")).data.routes.length, 3);
  await call("/api/home", "PUT", { label: "Another base", lat: 53, lng: -1 });
  assert.equal((await call("/api/state")).data.routes.length, 0);
  assert.equal((await call("/api/export", "GET", null, false)).status, 401);
  assert.equal(
    (await call("/api/visits", "POST", { ...draft, attendees: ["Ana", "ana"] }))
      .status,
    400,
  );
  assert.equal(
    (await call("/api/visits", "POST", { ...draft, attendees: ["  "] })).status,
    400,
  );
  const repeated = await call("/api/visits", "POST", {
    ...draft,
    date: "2025-08-30",
    published: true,
    attendees: [" Ana ", "Sam"],
  });
  assert.equal(repeated.status, 201);
  assert.notEqual(repeated.data.visit.id, visit.id);
  const history = (await call("/api/state")).data;
  assert.equal(history.visits.length, 2);
  assert.equal(history.outward.visitedCount, 1);
  assert.deepEqual(
    history.visits.find((v) => v.id === repeated.data.visit.id).attendees,
    ["Ana", "Sam"],
  );
  assert.deepEqual(
    (await call("/api/state", "GET", null, false)).data.visits.find(
      (v) => v.id === repeated.data.visit.id,
    ).attendees,
    ["Ana", "Sam"],
  );
  assert.deepEqual(
    (await call("/api/export")).data.visits.find(
      (v) => v.id === repeated.data.visit.id,
    ).attendees,
    ["Ana", "Sam"],
  );
  await call("/api/visits/" + visit.id, "DELETE");
  assert.equal((await call("/api/state")).data.outward.visitedCount, 1);
  await call("/api/visits/" + repeated.data.visit.id, "DELETE");
  assert.equal((await call("/api/state")).data.visits.length, 0);
});

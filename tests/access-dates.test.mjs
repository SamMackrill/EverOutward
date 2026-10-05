import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createAccessMonitor,
  parseAccessDates,
  accessToday,
} from "../server/access-dates.mjs";
import { limitedAccess } from "../server/access-rules.mjs";
import { createStore } from "../server/store.mjs";
import { createApp } from "../server/app.mjs";
import { journalSnapshot } from "../server/publish-journal.mjs";

const placeId = "207a7c87-e721-49cf-a5a9-f9d14cb7c821";
const rule = limitedAccess[placeId];
const places = [
  { id: placeId, name: "Ramsey Abbey Gatehouse", lat: 52.45, lng: -0.1 },
];
const html = (days) =>
  `<script type="application/json" id="__NEXT_DATA__">${JSON.stringify({
    props: {
      pageProps: {
        appContext: { place: { data: { _embedded: { opening: { days } } } } },
      },
    },
  })}</script>`;
const open = (name = "Gatehouse") => ({
  status: "FULLY_OPEN",
  assets: [{ name, opensAt: "14:00", closesAt: "17:00" }],
});

test("calendar parsing uses actual future building dates and ignores grounds, closed and unpublished days", () => {
  assert.deepEqual(
    parseAccessDates(
      html({
        "2026-09-01": open(),
        "2026-10-05": open(),
        "2026-10-06": { status: "CLOSED", assets: [] },
        "2026-10-07": { status: "NO_DATA", assets: [] },
        "2026-10-08": open("Grounds"),
        "2026-10-09": { status: "PARTIALLY_OPEN", assets: open().assets },
        "2026-10-10": {
          status: "FULLY_OPEN",
          assets: [
            { name: "Gatehouse", opensAt: "Closed", closesAt: "Closed" },
          ],
        },
      }),
      rule,
      "2026-10-05",
    ),
    [
      { date: "2026-10-05", hours: "Gatehouse: 14:00–17:00" },
      { date: "2026-10-09", hours: "Gatehouse: 14:00–17:00" },
    ],
  );
  assert.throws(
    () => parseAccessDates("<p>Open Sunday 1 November</p>", rule),
    /could not be read/,
  );
  assert.throws(() => parseAccessDates(html({}), rule), /unavailable/);
  assert.throws(
    () =>
      parseAccessDates(
        html({ "2026-11-01": { status: "UNKNOWN" } }),
        rule,
        "2026-10-05",
      ),
    /unrecognised opening status/,
  );
  assert.throws(
    () => parseAccessDates(html({ "2027-02-30": open() }), rule, "2026-10-05"),
    /unrecognised date/,
  );
  assert.equal(accessToday(new Date("2026-07-01T23:30:00Z")), "2026-07-02");
});

test("daily checks persist new-date alerts, acknowledgements, failures and restart scheduling", async (t) => {
  const store = createStore(":memory:");
  t.after(() => store.close());
  let now = new Date("2026-10-05T12:00:00Z"),
    calls = 0,
    failing = false;
  let days = { "2026-11-01": open() };
  const options = {
    store,
    places,
    now: () => now,
    fetcher: async () => {
      calls++;
      if (failing) throw new Error("Offline");
      return new Response(html(days));
    },
  };
  let monitor = createAccessMonitor(options);
  assert.equal(monitor.entries()[0].checkedAt, null);
  const [initial] = await monitor.check();
  assert.deepEqual(initial.newDates, ["2026-11-01"]);
  assert.equal(initial.nextCheckAt, "2026-10-06T12:00:00.000Z");
  assert.equal("seenDates" in initial, false);
  monitor.acknowledge(placeId, initial.newDates);
  await monitor.check(true);
  assert.equal(calls, 1);
  monitor = createAccessMonitor(options);
  await monitor.check();
  assert.equal(calls, 1);
  assert.deepEqual(monitor.entries()[0].newDates, []);
  now = new Date("2026-10-06T12:00:00Z");
  days["2026-11-08"] = open();
  const [updated] = await monitor.check();
  assert.deepEqual(updated.newDates, ["2026-11-08"]);
  // A stale acknowledgement must not dismiss a date announced after it loaded.
  monitor.acknowledge(placeId, ["2026-11-01"]);
  assert.deepEqual(monitor.entries()[0].newDates, ["2026-11-08"]);
  now = new Date("2026-10-07T12:00:00Z");
  failing = true;
  const [failed] = await monitor.check();
  assert.equal(failed.error, "Offline");
  assert.equal(failed.checkedAt, updated.checkedAt);
  assert.deepEqual(failed.dates, updated.dates);
  await monitor.check();
  assert.equal(calls, 3);
  failing = false;
  now = new Date("2026-10-08T12:00:00Z");
  delete days["2026-11-08"];
  const [withdrawn] = await monitor.check();
  assert.deepEqual(withdrawn.newDates, []);
  assert.equal(withdrawn.error, null);
  now = new Date("2026-11-02T12:00:00Z");
  assert.deepEqual(monitor.entries()[0].dates, []);
  assert.notEqual(journalSnapshot(store).accessDates.length, 0);
});

test("overlapping checks share one request and preserve acknowledgements during a fetch", async (t) => {
  const store = createStore(":memory:");
  t.after(() => store.close());
  store.put("accessDates", placeId, {
    dates: [{ date: "2026-11-01", hours: "14:00–17:00" }],
    newDates: ["2026-11-01"],
    seenDates: ["2026-11-01"],
  });
  let resolveFetch,
    calls = 0;
  const monitor = createAccessMonitor({
    store,
    places,
    now: () => new Date("2026-10-05T12:00:00Z"),
    fetcher: () => {
      calls++;
      return new Promise((resolve) => {
        resolveFetch = resolve;
      });
    },
  });
  const first = monitor.check(),
    second = monitor.check(true);
  assert.equal(first, second);
  monitor.acknowledge(placeId, ["2026-11-01"]);
  resolveFetch(
    new Response(html({ "2026-11-01": open(), "2026-11-08": open() })),
  );
  const [result] = await first;
  assert.equal(calls, 1);
  assert.deepEqual(result.newDates, ["2026-11-08"]);
});

test("off-site redirects and oversized pages fail without clearing the last successful dates", async (t) => {
  const store = createStore(":memory:");
  t.after(() => store.close());
  let calls = 0;
  const monitor = createAccessMonitor({
    store,
    places,
    now: () => new Date("2026-10-05T12:00:00Z"),
    fetcher: async () => {
      calls++;
      return new Response(null, {
        status: 302,
        headers: { Location: "http://127.0.0.1/private" },
      });
    },
  });
  assert.match((await monitor.check())[0].error, /outside the National Trust/);
  assert.equal(calls, 1);
  const oversized = createAccessMonitor({
    store,
    places,
    now: () => new Date("2026-10-06T12:00:00Z"),
    fetcher: async () => new Response("x".repeat(2_000_001)),
  });
  assert.match((await oversized.check())[0].error, /too large/);
});

test("access-date API is owner-only for checks and acknowledgements and exports safe public status", async (t) => {
  const store = createStore(":memory:");
  const app = createApp({
    store,
    places,
    enableCloud: false,
    localOwner: false,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => {
    server.close();
    store.close();
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const headers = {
    Origin: "http://127.0.0.1:5173",
    "X-EverOutward": "1",
    "Content-Type": "application/json",
  };
  for (const path of ["check", `${placeId}/acknowledge`]) {
    assert.equal(
      (
        await fetch(`${origin}/api/access-dates/${path}`, {
          method: "POST",
          headers,
          body: "{}",
        })
      ).status,
      401,
    );
  }
  store.put("accessDates", placeId, {
    dates: [{ date: "2099-11-01", hours: "14:00–17:00" }],
    newDates: ["2099-11-01"],
    seenDates: ["private-tracking"],
    checkedAt: "2026-10-05T12:00:00Z",
  });
  const json = await (await fetch(`${origin}/api/state`)).json();
  assert.equal(json.accessDates.length, 1);
  assert.equal(JSON.stringify(json).includes("private-tracking"), false);
  assert.deepEqual(
    (await (await fetch(`${origin}/api/access-dates`)).json()).entries,
    json.accessDates,
  );
});

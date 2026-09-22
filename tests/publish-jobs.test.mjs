import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../server/store.mjs";
import {
  createPublishJobs,
  runPublishJob,
  updatePublishJob,
} from "../server/publish-jobs.mjs";
import {
  publishedVisitHash,
  visitPublicationStatus,
} from "../server/publish-journal.mjs";
import { publicJournal } from "../server/homes.mjs";
import { createApp } from "../server/app.mjs";

test("the real background launcher survives its parent process exiting", async () => {
  const dir = mkdtempSync(join(tmpdir(), "eo-worker-")),
    database = join(dir, "journal.sqlite"),
    worker = join(dir, "worker.mjs");
  const storeModule = new URL("../server/store.mjs", import.meta.url).href;
  const jobsModule = new URL("../server/publish-jobs.mjs", import.meta.url)
    .href;
  writeFileSync(
    worker,
    `import {createStore} from ${JSON.stringify(storeModule)};
import {runPublishJob} from ${JSON.stringify(jobsModule)};
import {existsSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
const store=createStore(process.argv[3]);
try {await runPublishJob(store,process.argv[2],async progress=>{
 progress('Waiting for test release');
 const deadline=Date.now()+10000;
 while(!existsSync(process.argv[3]+'.go')){if(Date.now()>deadline)throw new Error('Test release timed out');await delay(25);}
 return {publishedVisitCount:3};
});}finally{store.close();}`,
  );
  const launcher = `import {createStore} from ${JSON.stringify(storeModule)};
import {createPublishJobs} from ${JSON.stringify(jobsModule)};
const store=createStore(${JSON.stringify(database)});
console.log(JSON.stringify(createPublishJobs({store,workerPath:${JSON.stringify(worker)}}).start()));
store.close();`;
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ["--input-type=module", "-e", launcher],
    { timeout: 10000 },
  );
  const original = JSON.parse(stdout);
  const store = createStore(database);
  try {
    const jobs = createPublishJobs({ store });
    const deadline = Date.now() + 10000;
    while (jobs.status().message !== "Waiting for test release") {
      assert(Date.now() < deadline);
      await delay(25);
    }
    assert.equal(jobs.status().id, original.id);
    assert.equal(jobs.status().status, "running");
    writeFileSync(database + ".go", "ready");
    while (jobs.status().status === "running") {
      assert(Date.now() < deadline);
      await delay(25);
    }
    assert.equal(jobs.status().status, "succeeded");
    assert.equal(jobs.status().result.publishedVisitCount, 3);
  } finally {
    writeFileSync(database + ".go", "ready");
    store.close();
  }
});

test("publish jobs are shared across connections, survive API recreation, and preserve actionable failures for retry", async () => {
  const file = join(
    mkdtempSync(join(tmpdir(), "eo-publish-")),
    "journal.sqlite",
  );
  const first = createStore(file),
    second = createStore(file);
  let launches = 0;
  const launch = () => launches++;
  try {
    const a = createPublishJobs({ store: first, launch });
    const started = a.start();
    const b = createPublishJobs({ store: second, launch });
    assert.equal(b.start().id, started.id);
    assert.equal(launches, 1);
    let release;
    const barrier = new Promise((r) => (release = r));
    const work = runPublishJob(second, started.id, async (progress) => {
      progress("Uploading photographs…");
      await barrier;
      throw new Error(
        "The journal changed during publication. Publish again to include the latest edits.",
      );
    });
    assert.equal(a.status().message, "Uploading photographs…");
    first.close();
    release();
    await work;
    assert.equal(b.status().status, "failed");
    assert.match(b.status().error, /journal changed/);
    const retry = b.start();
    assert.notEqual(retry.id, started.id);
    await runPublishJob(second, retry.id, async () => ({
      publishedVisitCount: 2,
      siteUrl: "https://example.here.now/",
    }));
    assert.equal(b.status().status, "succeeded");
    assert.equal(b.status().result.publishedVisitCount, 2);
    updatePublishJob(second, started.id, { status: "failed" });
    assert.equal(
      b.status().status,
      "succeeded",
      "old workers cannot replace newer results",
    );
  } finally {
    second.close();
  }
});

test("stopped publishing processes become retryable; a live worker stays running", () => {
  const store = createStore(":memory:");
  try {
    store.put("settings", "publishJob", {
      id: "old",
      status: "running",
      pid: 123,
      startedAt: "2000-01-01",
    });
    assert.equal(
      createPublishJobs({ store, isAlive: () => true }).status().status,
      "running",
    );
    const jobs = createPublishJobs({
      store,
      isAlive: () => false,
      launch: () => {},
    });
    assert.equal(jobs.status().status, "failed");
    assert.notEqual(jobs.start().id, "old");
  } finally {
    store.close();
  }
});

test("publication status distinguishes selected visits, live content, edits, exclusions and renamed homes", () => {
  const home = {
    id: "home",
    label: "CB3 0LL",
    colour: "#007a3b",
    lat: 52,
    lng: 0,
    version: "v1",
  };
  const visit = {
    id: "visit",
    published: true,
    title: "A trip",
    startingHomeId: home.id,
    startingHomeSnapshot: { label: home.label, lat: home.lat, lng: home.lng },
  };
  const ledger = { visits: { [visit.id]: publishedVisitHash(visit, [home]) } };
  assert.equal(visitPublicationStatus(visit, null, [home]), "Ready to publish");
  assert.equal(visitPublicationStatus(visit, ledger, [home]), "Published");
  assert.equal(
    visitPublicationStatus({ ...visit, title: "Revised" }, ledger, [home]),
    "Changes not yet published",
  );
  assert.equal(
    visitPublicationStatus({ ...visit, published: false }, ledger, [home]),
    "Removal pending publish",
  );
  assert.equal(
    visitPublicationStatus({ ...visit, published: false }, null, [home]),
    "Only on this computer",
  );
  const renamed = { ...home, label: "Girton" };
  assert.equal(
    visitPublicationStatus(visit, ledger, [renamed]),
    "Changes not yet published",
  );
  const journal = publicJournal([], [visit], [renamed], [], home.id);
  assert.equal(journal.visits[0].startingHomeLabel, "Girton");
  assert.equal(visit.startingHomeSnapshot.label, "CB3 0LL");
  assert.equal(journal.visits[0].startingHomeSnapshot, undefined);
});

test("publish API acknowledges a job immediately and safely changes just a visit's publication choice", async (t) => {
  const store = createStore(":memory:");
  let launched = 0;
  const publisher = createPublishJobs({ store, launch: () => launched++ });
  const app = createApp({
    store,
    places: [],
    localOwner: true,
    enableCloud: false,
    publisher,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => {
    server.close();
    store.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, method, body) =>
    fetch(base + path, {
      method,
      headers: {
        Origin: "http://127.0.0.1:5173",
        "X-EverOutward": "1",
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const first = await call("/api/publish", "POST");
  assert.equal(first.status, 202);
  const id = (await first.json()).job.id;
  assert.equal((await (await call("/api/publish", "POST")).json()).job.id, id);
  assert.equal(
    (await (await call("/api/publish", "GET")).json()).job.status,
    "running",
  );
  assert.equal(launched, 1);
  const visit = {
    id: "v",
    title: "My Fair Lady",
    published: false,
    updatedAt: "original",
    notes: "Keep notes",
    photos: [{ url: "keep-photo" }],
    startingHomeSnapshot: { label: "Girton", lat: 52 },
  };
  store.put("visits", visit.id, visit);
  assert.equal(
    (
      await call("/api/visits/v/publication", "PATCH", {
        published: true,
        updatedAt: "stale",
      })
    ).status,
    409,
  );
  const changed = await call("/api/visits/v/publication", "PATCH", {
    published: true,
    updatedAt: "original",
  });
  assert.equal(changed.status, 200);
  const { published, updatedAt, ...rest } = store.get("visits", "v");
  assert.equal(published, true);
  assert.notEqual(updatedAt, "original");
  const { published: oldPublished, updatedAt: oldUpdated, ...original } = visit;
  assert.deepEqual(rest, original);
});

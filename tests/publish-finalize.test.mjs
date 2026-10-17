import { test } from "node:test";
import assert from "node:assert/strict";
import { finalizePublication } from "../server/publish-finalize.mjs";
import { cloudRequest } from "../server/herenow.mjs";
import { createStore } from "../server/store.mjs";
import { createPublishJobs, runPublishJob } from "../server/publish-jobs.mjs";

const response = {
  slug: "existing-site",
  siteUrl: "https://existing-site.here.now/",
  upload: { versionId: "uploaded-version" },
};
const result = {
  siteUrl: response.siteUrl,
  currentVersionId: response.upload.versionId,
  publishStatus: { state: "live" },
};
const timeout = () =>
  new DOMException("The operation was aborted due to timeout", "TimeoutError");
function fakeClock() {
  let time = 0;
  return {
    now: () => time,
    wait: async (ms) => {
      time += ms;
    },
  };
}

test("successful finalization submits exactly once and confirms the returned upload version", async () => {
  const calls = [];
  const actual = await finalizePublication(response, {
    request: async (path, options) => {
      calls.push({ path, options });
      return result;
    },
  });
  assert.deepEqual(actual, result);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/v1/publish/existing-site/finalize");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    versionId: "uploaded-version",
  });
  assert.ok(calls[0].options.signal instanceof AbortSignal);
});

test("a timed-out request can become live after several checks without finalizing or uploading again", async () => {
  const clock = fakeClock(),
    progress = [],
    methods = [];
  let checks = 0;
  const actual = await finalizePublication(response, {
    ...clock,
    baseVersionId: "previous-version",
    progress: (message) => progress.push(message),
    request: async (path, options) => {
      methods.push(options.method || "GET");
      if (options.method === "POST") throw timeout();
      checks++;
      return checks < 3 ? { currentVersionId: "previous-version" } : result;
    },
  });
  assert.equal(actual.currentVersionId, "uploaded-version");
  assert.deepEqual(methods, ["POST", "GET", "GET", "GET"]);
  assert.equal(clock.now(), 6000);
  assert.match(progress[2], /check 3/);
});

test("transient confirmation failures and server errors are recoverable, including a first publish", async () => {
  const clock = fakeClock();
  let checks = 0;
  const actual = await finalizePublication(response, {
    ...clock,
    previousPublishStatus: { state: "live" },
    request: async (_path, options) => {
      if (options.method === "POST")
        throw Object.assign(new Error("Gateway timeout"), { status: 504 });
      if (++checks === 1) throw new TypeError("fetch failed");
      if (checks === 2) return { currentVersionId: null };
      return { currentVersionId: "uploaded-version" };
    },
  });
  assert.deepEqual(actual, result);
  assert.equal(clock.now(), 6000);
});

test("explicit finalization rejections do not wait or retry", async () => {
  for (const status of [400, 401, 403, 409, 422, 429]) {
    let calls = 0;
    const rejection = Object.assign(new Error(`Rejected ${status}`), {
      status,
    });
    await assert.rejects(
      finalizePublication(response, {
        request: async () => {
          calls++;
          throw rejection;
        },
      }),
      (error) => error === rejection,
    );
    assert.equal(calls, 1);
  }
});

test("a different live version and authentication failure while confirming remain explicit failures", async () => {
  for (const scenario of ["drift", "auth"]) {
    const clock = fakeClock();
    await assert.rejects(
      finalizePublication(response, {
        ...clock,
        baseVersionId: "previous-version",
        request: async (_path, options) => {
          if (options.method === "POST") throw timeout();
          if (scenario === "auth")
            throw Object.assign(new Error("Access denied"), { status: 403 });
          return { currentVersionId: "someone-elses-version" };
        },
      }),
      scenario === "drift"
        ? /different version/
        : /live status could not be checked: Access denied/,
    );
    assert.equal(clock.now(), 0);
  }
});

test("confirmation eventually stops with a useful uncertainty message, including repeatedly unavailable status checks", async () => {
  for (const unavailable of [false, true]) {
    const clock = fakeClock();
    let posts = 0;
    await assert.rejects(
      finalizePublication(response, {
        ...clock,
        baseVersionId: "previous-version",
        request: async (_path, options) => {
          if (options.method === "POST") {
            posts++;
            throw timeout();
          }
          if (unavailable) throw timeout();
          return { currentVersionId: "previous-version" };
        },
      }),
      /within two minutes.*upload may still finish.*local journal is safe/,
    );
    assert.equal(posts, 1);
    assert.equal(clock.now(), 120_000);
  }
});

test("the persistent publish job remains running during delayed confirmation and finishes with the confirmed version", async (t) => {
  const store = createStore(":memory:");
  t.after(() => store.close());
  const jobs = createPublishJobs({ store, launch: () => {} });
  const job = jobs.start();
  let waiting, release;
  const entered = new Promise((resolve) => {
    waiting = resolve;
  });
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  let checks = 0;
  const publish = runPublishJob(store, job.id, (progress) =>
    finalizePublication(response, {
      baseVersionId: "previous-version",
      progress,
      request: async (_path, options) => {
        if (options.method === "POST") throw timeout();
        return ++checks === 1
          ? { currentVersionId: "previous-version" }
          : result;
      },
      wait: async () => {
        waiting();
        await barrier;
      },
    }),
  );
  await entered;
  assert.equal(jobs.status().status, "running");
  assert.match(jobs.status().message, /Confirming publication/);
  assert.equal(
    createPublishJobs({
      store,
      launch: () => assert.fail("Cannot launch a duplicate"),
    }).start().id,
    job.id,
  );
  release();
  await publish;
  assert.equal(jobs.status().status, "succeeded");
  assert.equal(jobs.status().result.currentVersionId, "uploaded-version");
});

test("cloud requests respect the finalizer's caller signal and retain HTTP status for explicit rejection handling", async (t) => {
  const originalKey = process.env.HERENOW_API_KEY;
  process.env.HERENOW_API_KEY = "synthetic-test-key";
  t.after(() => {
    if (originalKey === undefined) delete process.env.HERENOW_API_KEY;
    else process.env.HERENOW_API_KEY = originalKey;
  });
  const controller = new AbortController();
  let received;
  const fetch = t.mock.method(globalThis, "fetch", async (_url, options) => {
    received = options;
    return new Response(JSON.stringify({ ok: true }));
  });
  await cloudRequest("/api/test", { signal: controller.signal });
  assert.equal(received.signal, controller.signal);
  await cloudRequest("/api/test");
  assert.ok(received.signal instanceof AbortSignal);
  assert.notEqual(received.signal, controller.signal);
  fetch.mock.mockImplementation(
    async () =>
      new Response(JSON.stringify({ message: "Forbidden" }), { status: 403 }),
  );
  await assert.rejects(
    cloudRequest("/api/test"),
    (error) => error.status === 403 && error.message === "Forbidden",
  );
  fetch.mock.mockImplementation(
    async () => new Response("Access denied", { status: 403 }),
  );
  await assert.rejects(
    cloudRequest("/api/test"),
    (error) => error.status === 403,
  );
});

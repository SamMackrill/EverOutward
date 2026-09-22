import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const alive = (pid) => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
export function updatePublishJob(store, id, changes) {
  return store.transaction(() => {
    const job = store.get("settings", "publishJob");
    if (job?.id !== id || job.status !== "running") return job;
    const next = { ...job, ...changes, updatedAt: new Date().toISOString() };
    store.put("settings", "publishJob", next);
    return next;
  });
}

export function createPublishJobs({
  store,
  launch,
  isAlive = alive,
  workerPath = resolve(root, "scripts/publish-worker.mjs"),
}) {
  const status = () => {
    const job = store.get("settings", "publishJob");
    if (
      job?.status === "running" &&
      !isAlive(job.pid) &&
      Date.now() - Date.parse(job.startedAt) > 10000
    )
      return updatePublishJob(store, job.id, {
        status: "failed",
        error:
          "The publishing process stopped before confirming completion. Your local visits are safe. Retry publishing.",
        finishedAt: new Date().toISOString(),
      });
    return job;
  };
  const start = (queueIfRunning = false) => {
    let created = false;
    status();
    const job = store.transaction(() => {
      const existing = store.get("settings", "publishJob");
      if (existing?.status === "running") {
        if (queueIfRunning)
          store.put("settings", "publishRequested", { value: true });
        return existing;
      }
      store.delete("settings", "publishRequested");
      const job = {
        id: randomUUID(),
        status: "running",
        message: "Preparing your journal…",
        startedAt: new Date().toISOString(),
        pid: null,
      };
      store.put("settings", "publishJob", job);
      created = true;
      return job;
    });
    if (created) {
      try {
        if (launch) launch(job);
        else {
          if (store.filename === ":memory:")
            throw new Error("Publishing requires a saved local journal.");
          const env = { ...process.env };
          delete env.WATCH_REPORT_DEPENDENCIES;
          const child = spawn(
            process.execPath,
            [workerPath, job.id, resolve(store.filename)],
            {
              cwd: root,
              env,
              detached: true,
              windowsHide: true,
              stdio: "ignore",
            },
          );
          child.on("error", () =>
            updatePublishJob(store, job.id, {
              status: "failed",
              error:
                "The publishing process could not start. Retry publishing.",
            }),
          );
          updatePublishJob(store, job.id, { pid: child.pid });
          child.unref();
        }
      } catch (error) {
        updatePublishJob(store, job.id, {
          status: "failed",
          error: error.message,
        });
      }
    }
    return status();
  };
  return { start: () => start(), enqueue: () => start(true), status };
}

export async function runPublishJob(store, id, publish) {
  const job = store.get("settings", "publishJob");
  if (job?.id !== id || job.status !== "running") return;
  updatePublishJob(store, id, { pid: process.pid });
  try {
    const result = await publish((message) =>
      updatePublishJob(store, id, { message }),
    );
    return updatePublishJob(store, id, {
      status: "succeeded",
      message: "Your public journal is up to date.",
      result,
      finishedAt: new Date().toISOString(),
    });
  } catch (error) {
    return updatePublishJob(store, id, {
      status: "failed",
      error: String(error.message || error).slice(0, 2000),
      finishedAt: new Date().toISOString(),
    });
  }
}

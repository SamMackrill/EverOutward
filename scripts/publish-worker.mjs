import { createStore } from "../server/store.mjs";
import { runPublishJob, createPublishJobs } from "../server/publish-jobs.mjs";
import { publishWebsite } from "./publish.mjs";

const store = createStore(process.argv[3]);
try {
  await runPublishJob(store, process.argv[2], (progress) =>
    publishWebsite(progress),
  );
  if (store.get("settings", "publishRequested")?.value)
    createPublishJobs({ store }).start();
} finally {
  store.close();
}

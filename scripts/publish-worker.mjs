import { createStore } from "../server/store.mjs";
import { runPublishJob } from "../server/publish-jobs.mjs";
import { publishWebsite } from "./publish.mjs";

const store = createStore(process.argv[3]);
try {
  await runPublishJob(store, process.argv[2], (progress) =>
    publishWebsite(progress),
  );
} finally {
  store.close();
}

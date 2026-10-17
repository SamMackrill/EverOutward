import { setTimeout as delay } from "node:timers/promises";
import { cloudRequest } from "./herenow.mjs";

const finalizeTimeout = 90_000;
const confirmationTimeout = 120_000;
const checkInterval = 3_000;

/** Send finalization once. A lost response is uncertain until this exact version is live. */
export async function finalizePublication(
  response,
  {
    baseVersionId,
    previousPublishStatus,
    progress = () => {},
    request = cloudRequest,
    now = Date.now,
    wait = delay,
  } = {},
) {
  const versionId = response.upload.versionId;
  const path = `/api/v1/publish/${response.slug}`;
  try {
    const result = await request(`${path}/finalize`, {
      method: "POST",
      body: JSON.stringify({ versionId }),
      signal: AbortSignal.timeout(finalizeTimeout),
    });
    if (result.currentVersionId === versionId) return result;
    throw new Error("The host did not confirm the uploaded version.");
  } catch (error) {
    // An explicit rejection is actionable; a network/server failure can be a lost success.
    if (error.status >= 400 && error.status < 500 && error.status !== 408)
      throw error;
  }

  const deadline = now() + confirmationTimeout;
  let attempts = 0;
  while (now() < deadline) {
    progress(`Confirming publication with the host · check ${++attempts}…`);
    let live;
    try {
      live = await request(path, {
        signal: AbortSignal.timeout(Math.min(10_000, deadline - now())),
      });
    } catch (error) {
      if (error.status >= 400 && error.status < 500 && error.status !== 408)
        throw new Error(
          `The upload may still finish, but its live status could not be checked: ${error.message}`,
          { cause: error },
        );
      // Transient status-check errors do not turn an uncertain upload into a failure.
    }
    if (live?.currentVersionId === versionId)
      return {
        siteUrl: live.siteUrl || response.siteUrl,
        currentVersionId: versionId,
        publishStatus: live.publishStatus || previousPublishStatus,
      };
    if (live?.currentVersionId && live.currentVersionId !== baseVersionId)
      throw new Error(
        "The live site changed to a different version while confirming publication. Review it before publishing again.",
      );
    const remaining = deadline - now();
    if (remaining > 0) await wait(Math.min(checkInterval, remaining));
  }
  throw new Error(
    "The host did not confirm publication within two minutes of the interrupted request. The upload may still finish; retry publishing to check again. Your local journal is safe.",
  );
}

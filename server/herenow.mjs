import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export async function credentials() {
  const key =
    process.env.HERENOW_API_KEY ||
    (
      await readFile(join(homedir(), ".herenow/credentials"), "utf8").catch(
        () => "",
      )
    ).trim();
  if (!key) throw new Error("here.now credentials are not configured locally.");
  return key;
}
export async function cloudRequest(path, options = {}) {
  const response = await fetch(`https://here.now${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${await credentials()}`,
      "X-HereNow-Client": "codex/ever-outward",
      "Content-Type": "application/json",
      ...options.headers,
    },
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.message || data.error || `here.now: ${response.status}`,
    );
  return data;
}
export async function siteState() {
  return JSON.parse(
    await readFile(".herenow/state.json", "utf8").catch(() => "{}"),
  );
}
export async function cloudRecords(collection) {
  const { slug } = await siteState();
  if (!slug) return [];
  const records = [];
  let cursor;
  do {
    const data = await cloudRequest(
      `/api/v1/publishes/${slug}/data/${collection}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    records.push(...data.records);
    cursor = data.nextCursor;
  } while (cursor);
  return records;
}

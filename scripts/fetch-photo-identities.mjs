import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";
import { photoIdentity, searchUrl } from "./destination-photos.mjs";

// Query public property identities once; never send home locations or visits.
const query = `SELECT ?item ?itemLabel ?image ?location ?category WHERE {
  ?item (wdt:P127|wdt:P137) wd:Q333515; wdt:P18 ?image; wdt:P625 ?location.
  OPTIONAL { ?item wdt:P373 ?category. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
const root = ".local/destination-photos";
await mkdir(root, { recursive: true });
async function save(path, data) {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, JSON.stringify(data, null, 2) + "\n");
  await rename(temporary, path);
}
const headers = {
  "User-Agent":
    "EverOutward/0.1 (National Trust destination photo library; https://github.com/SamMackrill/EverOutward)",
};
const url = new URL("https://query.wikidata.org/sparql");
url.searchParams.set("query", query);
url.searchParams.set("format", "json");
const response = await fetch(url, {
  headers: { ...headers, Accept: "application/sparql-results+json" },
  signal: AbortSignal.timeout(50000),
  redirect: "error",
});
if (!response.ok)
  throw new Error(
    `Wikidata identity query: HTTP ${response.status}; existing caches preserved`,
  );
const data = await response.json();
if (!Array.isArray(data.results?.bindings))
  throw new Error("Invalid Wikidata identity response");
await save(`${root}/wikidata-owned.json`, data);
const { places } = JSON.parse(
  await readFile("public/data/places.json", "utf8"),
);
const identities = Object.fromEntries(
  places
    .map((place) => [place.id, photoIdentity(place, data.results.bindings)])
    .filter(([, identity]) => identity),
);
// A batch of 20 file titles is well below the Commons API's title limit.
const entries = Object.entries(identities);
for (let index = 0; index < entries.length; index += 20) {
  const batch = entries.slice(index, index + 20);
  await wait(1500);
  const request = searchUrl(
    null,
    batch.map(([, identity]) => identity.fileTitle).join("|"),
  );
  const result = await fetch(request, {
    headers,
    signal: AbortSignal.timeout(30000),
    redirect: "error",
  });
  if (!result.ok)
    throw new Error(
      `Commons identity metadata: HTTP ${result.status}; completed batches preserved`,
    );
  const files = await result.json();
  if (files.error)
    throw new Error(`Commons identity metadata: ${files.error.info}`);
  for (const [id, identity] of batch) {
    const normalizeTitle = (title) => title.replace(/_/g, " ");
    const page = (files.query?.pages || []).find(
      (page) =>
        normalizeTitle(page.title) === normalizeTitle(identity.fileTitle),
    );
    if (page)
      await save(`${root}/identity-${id}.json`, {
        identity,
        query: { pages: [page] },
      });
  }
  console.log(
    `Cached primary photo metadata: ${Math.min(index + 20, entries.length)}/${entries.length}`,
  );
}
console.log(
  "Primary photo identities cached. Run npm run photos:import to include them.",
);

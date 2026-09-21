import { mkdir, writeFile, readFile } from "node:fs/promises";

const service =
  "https://services-eu1.arcgis.com/NPIbx47lsIiu2pqz/ArcGIS/rest/services/National_Trust_Visitor_Properties_/FeatureServer/0";
const get = async (path) => {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Import failed: ${response.status}`);
  return response.json();
};
const { count } = await get(
  `${service}/query?where=1%3D1&returnCountOnly=true&f=json`,
);
const features = [];
for (let offset = 0; offset < count; offset += 500) {
  const result = await get(
    `${service}/query?where=1%3D1&outFields=*&outSR=4326&orderByFields=OBJECTID&resultOffset=${offset}&resultRecordCount=500&f=json`,
  );
  if (result.error || !result.features?.length)
    throw new Error("Catalogue query returned no records.");
  features.push(...result.features);
}
const details = JSON.parse(
  await readFile(new URL("./place-details.json", import.meta.url), "utf8"),
);
const places = features.map(({ attributes: a, geometry: g }) => {
  if (
    !g ||
    !Number.isFinite(g.x) ||
    !Number.isFinite(g.y) ||
    !a.Visitor_Property_Name
  )
    throw new Error("Invalid source record");
  return {
    id: a.GlobalID,
    name: a.Visitor_Property_Name,
    region: a.Region || "United Kingdom",
    lat: g.y,
    lng: g.x,
    sourceId: a.Vader_ID,
    organisation: "National Trust",
    officialUrl: "",
    description: "",
    image: "",
    hours: "Check official opening times",
    entranceVerified: false,
    ...(details[a.GlobalID] || {}),
  };
});
if (new Set(places.map((p) => p.id)).size !== count)
  throw new Error("Duplicate IDs or count mismatch");
await mkdir("public/data", { recursive: true });
await writeFile(
  "public/data/places.json",
  JSON.stringify(
    {
      importedAt: new Date().toISOString(),
      source: service,
      licence: "CC BY 4.0",
      attribution:
        "National Trust, SMU, GIS Product Team — 2024. Converted to WGS84 and normalised for Ever Outward.",
      coverage:
        "Source records, awaiting visitor-entrance reconciliation; National Trust for Scotland excluded.",
      places,
    },
    null,
    2,
  ),
);
console.log(`Imported ${places.length} National Trust source records.`);

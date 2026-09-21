import { writeFile } from "node:fs/promises";

const root =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/";
const names = [
  "ne_10m_admin_0_countries.geojson",
  "ne_10m_populated_places_simple.geojson",
];
const [countries, cities] = await Promise.all(
  names.map(async (name) => {
    const response = await fetch(root + name);
    if (!response.ok)
      throw new Error(`Basemap download failed: ${response.status}`);
    return response.json();
  }),
);
const inside = ([lng, lat]) => lng > -16 && lng < 20 && lat > 43 && lat < 64;
const features = countries.features.flatMap((f) => {
  const polygons =
    f.geometry.type === "Polygon"
      ? [f.geometry.coordinates]
      : f.geometry.coordinates;
  const selected = polygons.filter((p) => p[0].some(inside));
  return selected.length
    ? [
        {
          type: "Feature",
          properties: { name: f.properties.ADMIN, code: f.properties.ADM0_A3 },
          geometry: { type: "MultiPolygon", coordinates: selected },
        },
      ]
    : [];
});
const labels = cities.features
  .filter(
    (f) =>
      inside(f.geometry.coordinates) &&
      ["GBR", "IRL"].includes(f.properties.adm0_a3),
  )
  .map((f) => ({
    name: f.properties.name,
    lat: f.geometry.coordinates[1],
    lng: f.geometry.coordinates[0],
    zoom: Math.max(5, Math.min(10, Math.ceil(f.properties.min_zoom || 7))),
  }));
await writeFile(
  "public/data/basemap.json",
  JSON.stringify({
    source: root,
    licence: "Public domain — Natural Earth",
    countries: { type: "FeatureCollection", features },
    cities: labels,
  }),
);
console.log(
  `Bundled ${features.length} country outlines and ${labels.length} UK/Ireland settlement labels.`,
);

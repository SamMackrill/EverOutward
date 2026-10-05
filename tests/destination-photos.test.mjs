import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  assessCandidate,
  metadataText,
  photoLicence,
  readPhoto,
  searchUrl,
  MAX_PHOTO_BYTES,
  photoIdentity,
  matchesIdentityCategory,
  nearbySearchUrl,
} from "../scripts/destination-photos.mjs";

const place = { id: "lyveden", name: "Lyveden", lat: 52.4567, lng: -0.554 };
function page(overrides = {}) {
  const metadata = {
    Artist: { value: '<a href="//example.org">Keith &amp; Jane</a>' },
    LicenseShortName: { value: "CC BY-SA 2.0" },
    LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/2.0/" },
    GPSLatitude: { value: "52.456716" },
    GPSLongitude: { value: "-0.554037" },
    ImageDescription: { value: "Lyveden New Bield" },
  };
  return {
    title: "File:Lyveden New Bield.jpg",
    imageinfo: [
      {
        mime: "image/jpeg",
        width: 1200,
        height: 800,
        thumburl:
          "https://upload.wikimedia.org/wikipedia/commons/a/aa/Lyveden.jpg",
        descriptionurl: "https://commons.wikimedia.org/wiki/File:Lyveden.jpg",
        extmetadata: { ...metadata, ...overrides },
      },
    ],
  };
}
test("selects a named nearby licensed photograph and preserves textual credits", () => {
  const candidate = assessCandidate(place, page());
  assert.equal(candidate.accepted, true);
  assert.equal(candidate.author, "Keith & Jane");
  assert.ok(candidate.distance < 5);
  assert.equal(
    metadataText("<script>unsafe()</script>Fran&#231;ois&nbsp;O&#x27;Brien"),
    "François O'Brien",
  );
});
test("rejects a same-name place elsewhere and requires review without coordinates", () => {
  assert.equal(
    assessCandidate(place, page({ GPSLatitude: { value: "51.5" } })).accepted,
    false,
  );
  const missing = page();
  delete missing.imageinfo[0].extmetadata.GPSLatitude;
  assert.equal(assessCandidate(place, missing).accepted, false);
  assert.equal(
    assessCandidate(place, missing, { reviewed: true }).accepted,
    true,
  );
  assert.equal(
    assessCandidate(place, page({ GPSLatitude: { value: "51.5" } }), {
      reviewed: true,
    }).accepted,
    false,
  );
  const empty = page({ GPSLatitude: { value: "not a coordinate" } });
  assert.equal(assessCandidate(place, empty).accepted, false);
  const geodata = page();
  delete geodata.imageinfo[0].extmetadata.GPSLatitude;
  delete geodata.imageinfo[0].extmetadata.GPSLongitude;
  geodata.coordinates = [
    { lat: place.lat, lon: place.lng, primary: true, globe: "earth" },
  ];
  assert.equal(assessCandidate(place, geodata).accepted, true);
});
test("rejects unrelated nearby subjects, illustrations, unknown licensing and restricted files", () => {
  const unrelated = page({
    ImageDescription: { value: "A neighbouring house" },
  });
  unrelated.title = "File:Other house.jpg";
  assert.equal(assessCandidate(place, unrelated).accepted, false);
  const drawing = page();
  drawing.title = "File:Lyveden map.jpg";
  assert.equal(assessCandidate(place, drawing).accepted, false);
  assert.equal(
    assessCandidate(
      place,
      page({ Restrictions: { value: "personality rights" } }),
    ).accepted,
    false,
  );
  assert.equal(
    assessCandidate(place, page({ Artist: { value: "" } })).accepted,
    false,
  );
  assert.equal(
    assessCandidate(
      place,
      page({ LicenseShortName: { value: "CC BY-NC 4.0" } }),
    ).accepted,
    false,
  );
  assert.equal(
    assessCandidate(
      place,
      page({
        LicenseUrl: { value: "https://creativecommons.org/licenses/by/4.0/" },
      }),
    ).accepted,
    false,
  );
});
test("only downloads from trusted HTTPS hosts and creates destination-only search requests", () => {
  const hostile = page();
  hostile.imageinfo[0].thumburl = "https://evil.example/Lyveden.jpg";
  assert.equal(assessCandidate(place, hostile).accepted, false);
  hostile.imageinfo[0].thumburl = "http://upload.wikimedia.org/Lyveden.jpg";
  assert.equal(assessCandidate(place, hostile).accepted, false);
  assert.equal(searchUrl(place).searchParams.get("gsrsearch"), '"Lyveden"');
  assert.ok(
    searchUrl({ ...place, name: "Tudor Merchant's House" })
      .searchParams.get("gsrsearch")
      .includes("Merchant's"),
  );
  assert.ok(
    searchUrl({ ...place, name: "Attingham Park Estate: Town Walls Tower" })
      .searchParams.get("gsrsearch")
      .includes('"Town Walls Tower"'),
  );
  assert.equal(
    searchUrl(place, "File:Lyveden.jpg").searchParams.get("titles"),
    "File:Lyveden.jpg",
  );
  assert.equal(
    nearbySearchUrl(place).searchParams.get("ggscoord"),
    `${place.lat}|${place.lng}`,
  );
  assert.equal(
    nearbySearchUrl(place).searchParams.get("generator"),
    "geosearch",
  );
  assert.equal(
    photoLicence({
      LicenseShortName: { value: "Public domain" },
      Copyrighted: { value: "True" },
    }),
    null,
  );
});
test("bounds photo downloads and rejects HTML or corrupt JPEG responses", async () => {
  const valid = Uint8Array.from([255, 216, 255, 217]);
  assert.equal(
    (
      await readPhoto(
        new Response(valid, { headers: { "content-type": "image/jpeg" } }),
      )
    ).length,
    4,
  );
  await assert.rejects(readPhoto(new Response("<html>")), /not JPEG/);
  await assert.rejects(
    readPhoto(
      new Response("bad", { headers: { "content-type": "image/jpeg" } }),
    ),
    /Invalid JPEG/,
  );
  await assert.rejects(
    readPhoto(
      new Response(valid, {
        headers: {
          "content-type": "image/jpeg",
          "content-length": String(MAX_PHOTO_BYTES + 1),
        },
      }),
    ),
    /exceeds/,
  );
  await assert.rejects(
    readPhoto(
      new Response(new Uint8Array(MAX_PHOTO_BYTES + 1), {
        headers: { "content-type": "image/jpeg" },
      }),
    ),
    /exceeds/,
  );
});

test("Wikidata primary images require a matching National Trust property name and location", () => {
  const row = {
    item: { value: "http://www.wikidata.org/entity/Q123" },
    itemLabel: { value: "Lyveden Estate" },
    location: { value: "Point(-0.554 52.4567)" },
    image: {
      value: "http://commons.wikimedia.org/wiki/Special:FilePath/Lyveden.jpg",
    },
  };
  const identity = photoIdentity(place, [row]);
  assert.equal(identity.fileTitle, "File:Lyveden.jpg");
  assert.equal(identity.entity, "https://www.wikidata.org/wiki/Q123");
  assert.equal(
    photoIdentity(place, [
      { ...row, location: { value: "Point(-0.12 51.5)" } },
    ]),
    null,
  );
  assert.equal(
    photoIdentity(place, [{ ...row, itemLabel: { value: "Other house" } }]),
    null,
  );
  const primary = page();
  delete primary.imageinfo[0].extmetadata.GPSLatitude;
  assert.equal(
    assessCandidate(place, primary, { identified: true }).accepted,
    true,
  );
  assert.equal(
    assessCandidate(
      place,
      page({ LicenseShortName: { value: "All rights reserved" } }),
      { identified: true },
    ).accepted,
    false,
  );
  primary.title = "File:Lyveden car park.jpg";
  assert.equal(
    assessCandidate(place, primary, { identified: true }).accepted,
    false,
  );
  assert.equal(
    matchesIdentityCategory(
      page({
        Categories: { value: "Other buildings|Lyveden New Bield|Geograph" },
      }),
      { category: "Lyveden_New_Bield" },
    ),
    true,
  );
  assert.equal(
    matchesIdentityCategory(
      page({ Categories: { value: "Buildings in Northamptonshire" } }),
      { category: "Lyveden New Bield" },
    ),
    false,
  );
  assert.equal(
    assessCandidate(place, page({ DateTimeOriginal: { value: "1889" } }), {
      identified: true,
    }).accepted,
    false,
  );
});
test("resumes cached searches, preserves existing editorial content and reports missing files", async () => {
  const root = await mkdtemp(join(tmpdir(), "everoutward-photo-import-"));
  const script = fileURLToPath(
    new URL("../scripts/import-destination-photos.mjs", import.meta.url),
  );
  try {
    for (const path of [
      "public/data",
      "scripts",
      "src/assets/destinations",
      ".local/destination-photos",
    ])
      await mkdir(join(root, path), { recursive: true });
    const places = [
      { ...place, id: "cached", image: "" },
      { ...place, id: "existing", image: "" },
      { ...place, id: "broken", image: "" },
    ];
    const details = {
      existing: {
        image: "/photos/existing.jpg",
        description: "Carefully reviewed text",
        imageAuthor: "Original artist",
      },
      broken: { image: "/photos/missing.jpg" },
    };
    await writeFile(
      join(root, "public/data/places.json"),
      JSON.stringify({ places }),
    );
    await writeFile(
      join(root, "scripts/place-details.json"),
      JSON.stringify(details),
    );
    await writeFile(
      join(root, "src/assets/destinations/existing.jpg"),
      "fixture",
    );
    await writeFile(
      join(root, ".local/destination-photos/cached.json"),
      JSON.stringify({ query: { pages: [] } }),
    );
    await writeFile(
      join(root, ".local/destination-photos/nearby-cached.json"),
      JSON.stringify({ query: { pages: [] } }),
    );
    const run = () =>
      execFileSync(process.execPath, [script], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    assert.match(run(), /Lyveden: unavailable/);
    assert.equal(
      JSON.parse(
        await readFile(join(root, ".local/destination-photos/report.json")),
      ).places.broken.status,
      "error",
    );
    assert.doesNotMatch(run(), /Lyveden: unavailable/);
    assert.deepEqual(
      JSON.parse(await readFile(join(root, "scripts/place-details.json"))),
      details,
    );
    // An active process lock rejects a second importer; an exited PID recovers.
    await writeFile(
      join(root, ".local/destination-photos/import.lock"),
      String(process.pid),
    );
    assert.throws(run, /already running/);
    const exitedPid = execFileSync(
      process.execPath,
      ["-e", "console.log(process.pid)"],
      { encoding: "utf8" },
    ).trim();
    await writeFile(
      join(root, ".local/destination-photos/import.lock"),
      exitedPid,
    );
    assert.doesNotThrow(run);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

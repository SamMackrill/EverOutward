import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { places } = JSON.parse(
  await readFile("public/data/places.json", "utf8"),
);
const details = JSON.parse(
  await readFile("scripts/place-details.json", "utf8"),
);

test("every catalogue destination has a brief, sourced summary and relevant detail text", () => {
  for (const place of places) {
    const entry = details[place.id];
    assert.ok(entry, `Missing details for ${place.name}`);
    for (const field of ["summary", "description"]) {
      assert.ok(entry[field]?.trim(), `${place.name}: missing ${field}`);
      assert.doesNotMatch(
        entry[field],
        /(?:Discover|Explore) this National Trust place|Check the official visitor information/i,
      );
      assert.doesNotMatch(entry[field], /<[^>]+>|&(?:nbsp|amp|[a-z]+);/i);
    }
    assert.ok(
      entry.summary.split(/\s+/).length <= 25,
      `${place.name}: summary too long`,
    );
    for (const field of ["officialUrl", "descriptionSource"]) {
      const url = new URL(entry[field]);
      assert.equal(url.protocol, "https:");
      assert.equal(url.hostname, "www.nationaltrust.org.uk");
    }
  }
});

test("Nymans has a compact garden summary and a fuller description of the Messel home and woodland", () => {
  const nymans = details[places.find((place) => place.name === "Nymans").id];
  assert.equal(
    nymans.summary,
    "Extensive yet intimate garden set around a romantic ruined house.",
  );
  assert.match(nymans.description, /Messel/);
  assert.match(nymans.description, /woodland/);
  assert.notEqual(nymans.description, nymans.summary);
});

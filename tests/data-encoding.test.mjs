import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

// UTF-8 punctuation decoded as Windows-1252 turns ’ into â€™ and — into â€”.
const mojibake = /â€|Ã[\u0080-¿]|Â[ -¿]/;

async function files(dir, pattern) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await files(path, pattern)));
    else if (pattern.test(entry.name)) found.push(path);
  }
  return found;
}

test("data and source files contain no mis-encoded punctuation", async () => {
  const checked = [
    ...(await files("scripts", /\.(json|mjs)$/)),
    ...(await files("public/data", /\.json$/)),
    ...(await files("server", /\.mjs$/)),
    ...(await files("src", /\.(ts|tsx|css)$/)),
  ];
  assert.ok(checked.length > 0);
  const broken = [];
  for (const path of checked) {
    const lines = (await readFile(path, "utf8")).split("\n");
    lines.forEach((line, i) => {
      const match = line.match(mojibake);
      if (match) broken.push(`${path}:${i + 1} near "${match[0]}"`);
    });
  }
  assert.deepEqual(broken, []);
});

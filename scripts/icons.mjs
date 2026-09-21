import { readFile, writeFile } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";

const master = await readFile("public/icons/gate.svg", "utf8");
const small = master
  .replace(/<circle cx="256" cy="256" r="232"[^>]*\/>/, "")
  .replace(/<path d="M73 370[^>]*\/>/, "")
  .replace('viewBox="0 0 512 512"', 'viewBox="75 80 360 360"');
await writeFile("public/icons/gate-small.svg", small);
const render = (svg, size) =>
  new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
for (const size of [16, 32, 48, 64, 128, 180, 192, 256, 512, 1024])
  await writeFile(
    `public/icons/gate-${size}.png`,
    render(size <= 48 ? small : master, size),
  );
await writeFile("public/icons/apple-touch-icon.png", render(master, 180));
const dark = master
  .replaceAll("#eaf0e4", "#20352a")
  .replaceAll("#007a3b", "#94d5aa");
await writeFile("public/icons/gate-dark.svg", dark);
for (const size of [192, 512]) {
  await writeFile(`public/icons/gate-dark-${size}.png`, render(dark, size));
  const maskable = master
    .replace(
      '<circle cx="256"',
      '<rect width="512" height="512" fill="#eaf0e4"/><g transform="translate(52 52) scale(.8)"><circle cx="256"',
    )
    .replace("</svg>", "</g></svg>");
  await writeFile(
    `public/icons/gate-maskable-${size}.png`,
    render(maskable, size),
  );
}
const mono = master
  .replaceAll("#eaf0e4", "#ffffff")
  .replaceAll("#edb997", "#ffffff")
  .replaceAll("#efc2a1", "#ffffff")
  .replaceAll("#e3bc53", "#ffffff")
  .replace(
    /#(?:a6ba90|647e51|31493c|ba8d4e|302a29|304e45|263d31|64493a|ad675c)/g,
    "#007a3b",
  );
await writeFile("public/icons/gate-mono.svg", mono);
const pngs = await Promise.all(
  [16, 32, 48].map((n) => readFile(`public/icons/gate-${n}.png`)),
);
const header = Buffer.alloc(6 + 16 * pngs.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(pngs.length, 4);
let offset = header.length;
for (let i = 0; i < pngs.length; i++) {
  const pos = 6 + i * 16;
  header[pos] = [16, 32, 48][i];
  header[pos + 1] = header[pos];
  header.writeUInt16LE(1, pos + 4);
  header.writeUInt16LE(32, pos + 6);
  header.writeUInt32LE(pngs[i].length, pos + 8);
  header.writeUInt32LE(offset, pos + 12);
  offset += pngs[i].length;
}
await writeFile("public/icons/favicon.ico", Buffer.concat([header, ...pngs]));
console.log("Generated SVG variants, favicon and PNG icons (16–1024 px).");

import { haversine } from "../server/domain.mjs";

export const MAX_PHOTO_BYTES = 1_000_000;
export const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

/** Commons metadata is HTML. Keep credits as text, never executable markup. */
export function metadataText(value = "") {
  const entities = {
    amp: "&",
    quot: '"',
    apos: "'",
    lt: "<",
    gt: ">",
    nbsp: " ",
  };
  return String(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(x[\da-f]+|\d+);/gi, (match, number) => {
      const code =
        number[0].toLowerCase() === "x"
          ? parseInt(number.slice(1), 16)
          : Number(number);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    })
    .replace(
      /&(amp|quot|apos|lt|gt|nbsp);/gi,
      (_, name) => entities[name.toLowerCase()],
    )
    .replace(/\s+/g, " ")
    .trim();
}

const normalize = (text) =>
  metadataText(text)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Compound catalogue destinations can be illustrated by a named component. */
function searchNames(place) {
  const subjectName = place.name.split(":").at(-1).trim();
  return [
    ...new Set([
      place.name,
      place.name.replace(/\s*\([^)]*\)/g, ""),
      subjectName,
      subjectName.split(",")[0].trim(),
      ...subjectName.split(/\s+(?:and|to|&)\s+/i),
    ]),
  ].filter(
    (name) =>
      normalize(name).length >= 4 &&
      !/^(?:garden|gardens|park|coast|estate|woodland|woodlands|house|home|farm|shop|beach|visitor centre|nature reserve)$/.test(
        normalize(name),
      ),
  );
}

export function placeNames(place) {
  return [...new Set(searchNames(place).map(normalize))];
}

function safeUrl(value, hosts) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      hosts.includes(url.hostname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** Require an explicit compatible licence; never infer one from a search hit. */
export function photoLicence(metadata) {
  const label = metadataText(metadata.LicenseShortName?.value);
  const url = safeUrl(metadata.LicenseUrl?.value, ["creativecommons.org"]);
  const cc = /^(CC BY(?:-SA)?) (1\.0|2\.0|2\.5|3\.0|4\.0)$/.exec(label);
  if (cc && url) {
    const path = new URL(url).pathname.replace(/\/$/, "");
    const code = cc[1] === "CC BY-SA" ? "by-sa" : "by";
    if (
      path === `/licenses/${code}/${cc[2]}` ||
      path.startsWith(`/licenses/${code}/${cc[2]}/`)
    )
      return { label, url };
  }
  if (
    (label === "CC0" || label === "CC0 1.0") &&
    url &&
    new URL(url).pathname.startsWith("/publicdomain/zero/1.0")
  )
    return { label, url };
  if (
    label === "Public domain" &&
    /^false$/i.test(String(metadata.Copyrighted?.value))
  )
    return {
      label,
      url: "https://commons.wikimedia.org/wiki/Commons:Public_domain",
    };
  return null;
}

export function assessCandidate(
  place,
  page,
  { reviewed = false, identified = false } = {},
) {
  const info = page.imageinfo?.[0];
  if (!info) return { accepted: false, reason: "No file metadata" };
  const meta = info.extmetadata || {};
  const licence = photoLicence(meta);
  const author = metadataText(meta.Artist?.value);
  const source = safeUrl(info.descriptionurl, ["commons.wikimedia.org"]);
  const download = safeUrl(info.thumburl || info.url, [
    "upload.wikimedia.org",
    "thumb.wikimedia.org",
  ]);
  if (!licence || !author || !source || !download)
    return {
      accepted: false,
      reason: "Missing compatible licence, author or trusted source URL",
    };
  if (metadataText(meta.Restrictions?.value))
    return {
      accepted: false,
      reason: "File has additional restrictions requiring review",
    };
  if (
    info.mime !== "image/jpeg" ||
    info.width < 400 ||
    info.height < 250 ||
    info.width / info.height > 3 ||
    info.width / info.height < 0.6
  )
    return { accepted: false, reason: "Not a suitable JPEG photograph" };
  const title = metadataText(
    page.title.replace(/^File:/, "").replace(/\.(jpe?g)$/i, ""),
  );
  if (
    !reviewed &&
    /\b(?:18\d{2}|19[0-4]\d)\b/.test(metadataText(meta.DateTimeOriginal?.value))
  )
    return {
      accepted: false,
      reason: "Historical photograph needs review",
    };
  const description = metadataText(meta.ImageDescription?.value);
  const subject = normalize(title);
  const named = placeNames(place).some((name) =>
    ` ${subject} `.includes(` ${name} `),
  );
  const point = page.coordinates?.find(
    (coordinate) => coordinate.primary && coordinate.globe === "earth",
  );
  const lat = Number(meta.GPSLatitude?.value ?? point?.lat),
    lng = Number(meta.GPSLongitude?.value ?? point?.lon);
  const located =
    (meta.GPSLatitude?.value != null || point?.lat != null) &&
    (meta.GPSLongitude?.value != null || point?.lon != null) &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180;
  const distance = located ? haversine(place, { lat, lng }) : null;
  if (distance !== null && distance > 5000)
    return {
      accepted: false,
      reason: "Photograph is more than 5 km from the catalogue destination",
      distance,
    };
  if (!reviewed && !identified && (!named || distance === null))
    return {
      accepted: false,
      reason: "Needs subject/location review",
      distance,
    };
  if (
    !reviewed &&
    /\b(map|plan|diagram|portrait|coat of arms|logo|engraving|drawing|painting|postcard|junction|signpost|signage|car park)\b/i.test(
      title,
    )
  )
    return {
      accepted: false,
      reason: "Illustration or historical image needs review",
    };
  // A postcode, road or unrelated namesake cottage is not a destination cover.
  const incidental =
    /\b(cottage|farm|post box|postbox|letterbox|bus stop|road sign|street sign|telegraph|pylon|milepost|headstone|church|cemetery)\b/gi;
  if (
    !reviewed &&
    [...title.matchAll(incidental)].some(
      ([word]) => !normalize(place.name).includes(normalize(word)),
    )
  )
    return {
      accepted: false,
      reason: "Incidental subject needs review",
    };
  if (
    !reviewed &&
    /\b(?:road to|minor road|main road|end of the road)\b|^(?:front|main|high|back) street\b/i.test(
      title,
    ) &&
    !/\broad|street\b/i.test(place.name)
  )
    return {
      accepted: false,
      reason: "Street scene needs review",
    };
  return {
    accepted: true,
    title,
    description,
    author,
    licence,
    source,
    download,
    distance,
    attribution: metadataText(meta.Attribution?.value),
    credit: metadataText(meta.Credit?.value),
    width: info.thumbwidth || info.width,
    height: info.thumbheight || info.height,
    score:
      (placeNames(place).some(
        (name) => subject.startsWith(name + " ") || subject === name,
      )
        ? 30
        : 0) +
      (info.width >= info.height ? 20 : 0) +
      Math.min(info.width, 1600) / 160 +
      (distance === null ? 0 : 10 - distance / 500),
  };
}

/** Match a National Trust-owned Wikidata item by name AND public coordinates. */
export function photoIdentity(place, bindings) {
  const key = (name) =>
    normalize(
      name
        .split(":")
        .at(-1)
        .split(",")[0]
        .replace(/\s*\([^)]*\)/g, ""),
    )
      .replace(/\b(?:the|estate|house|gardens?|park|nature reserve)\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const wanted = key(place.name);
  if (wanted.length < 4) return null;
  const matches = bindings
    .flatMap((row) => {
      const coordinate = /^Point\(([-\d.]+) ([-\d.]+)\)$/.exec(
        row.location?.value || "",
      );
      if (!coordinate || key(row.itemLabel?.value || "") !== wanted) return [];
      const location = {
        lng: Number(coordinate[1]),
        lat: Number(coordinate[2]),
      };
      if (Math.abs(location.lat) > 90 || Math.abs(location.lng) > 180)
        return [];
      const distance = haversine(place, location);
      if (!Number.isFinite(distance) || distance > 3000) return [];
      let image;
      try {
        image = new URL(row.image?.value);
      } catch {
        return [];
      }
      if (
        image.hostname !== "commons.wikimedia.org" ||
        !image.pathname.startsWith("/wiki/Special:FilePath/")
      )
        return [];
      const entity = row.item?.value?.match(
        /^https?:\/\/www.wikidata.org\/entity\/(Q\d+)$/,
      )?.[1];
      if (!entity) return [];
      return [
        {
          fileTitle: `File:${decodeURIComponent(image.pathname.slice("/wiki/Special:FilePath/".length))}`,
          entity: `https://www.wikidata.org/wiki/${entity}`,
          label: row.itemLabel.value,
          category: metadataText(row.category?.value),
          ...location,
          distance,
        },
      ];
    })
    .sort((a, b) => a.distance - b.distance);
  return matches[0] || null;
}

/** Exact Commons category membership can confirm a property image without GPS. */
export function matchesIdentityCategory(page, identity) {
  if (!identity?.category) return false;
  return String(page.imageinfo?.[0]?.extmetadata?.Categories?.value || "")
    .split("|")
    .some((category) => normalize(category) === normalize(identity.category));
}

export function searchUrl(place, fileTitle) {
  const url = new URL(COMMONS_API);
  const parameters = {
    action: "query",
    format: "json",
    formatversion: "2",
    maxlag: "5",
    prop: "imageinfo|coordinates",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: "960",
    iiextmetadatalanguage: "en",
  };
  if (fileTitle) parameters.titles = fileTitle;
  else
    Object.assign(parameters, {
      generator: "search",
      gsrnamespace: "6",
      gsrlimit: "50",
      gsrsearch: searchNames(place)
        .map((name) => `"${name.replace(/["\\]/g, " ")}"`)
        .join(" OR "),
    });
  for (const [key, value] of Object.entries(parameters))
    url.searchParams.set(key, value);
  return url;
}

export function nearbySearchUrl(place) {
  const url = searchUrl(place);
  for (const key of [...url.searchParams.keys()])
    if (key.startsWith("gsr")) url.searchParams.delete(key);
  for (const [key, value] of Object.entries({
    generator: "geosearch",
    ggscoord: `${place.lat}|${place.lng}`,
    ggsradius: "5000",
    ggsnamespace: "6",
    ggslimit: "50",
  }))
    url.searchParams.set(key, value);
  return url;
}

/** A bounded download rejects HTML errors and avoids unbounded file growth. */
export async function readPhoto(response) {
  if (!response.ok)
    throw new Error(`Photo download returned HTTP ${response.status}`);
  if (
    !/^image\/jpeg(?:;|$)/i.test(response.headers.get("content-type") || "")
  ) {
    await response.body?.cancel();
    throw new Error("Photo response is not JPEG");
  }
  if (Number(response.headers.get("content-length")) > MAX_PHOTO_BYTES) {
    await response.body?.cancel();
    throw new Error("Photo exceeds 1 MB");
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > MAX_PHOTO_BYTES) throw new Error("Photo exceeds 1 MB");
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  if (
    buffer.length < 4 ||
    buffer[0] !== 0xff ||
    buffer[1] !== 0xd8 ||
    buffer.at(-2) !== 0xff ||
    buffer.at(-1) !== 0xd9
  )
    throw new Error("Invalid JPEG file");
  return buffer;
}

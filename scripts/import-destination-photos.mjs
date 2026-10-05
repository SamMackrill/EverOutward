import {
  readFile,
  writeFile,
  mkdir,
  rename,
  open,
  unlink,
  access,
} from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import {
  assessCandidate,
  searchUrl,
  readPhoto,
  photoIdentity,
  matchesIdentityCategory,
  nearbySearchUrl,
} from "./destination-photos.mjs";

const args = process.argv.slice(2);
const value = (flag) =>
  args.find((arg) => arg.startsWith(`${flag}=`))?.slice(flag.length + 1);
const flags = new Set(["--status", "--retry-missing", "--help"]);
for (const arg of args)
  if (
    !flags.has(arg) &&
    !/^--(limit|place|priority-state|reviewed)=.+/.test(arg)
  )
    throw new Error(`Unknown option: ${arg}`);
if (args.includes("--help")) {
  console.log(
    "npm run photos:import -- [--limit=N] [--place=ID] [--priority-state=FILE] [--reviewed=FILE] [--retry-missing] [--status]\nSaved progress and candidates: .local/destination-photos/report.json. Existing photographs are preserved.",
  );
  process.exit(0);
}
const limit =
  value("--limit") === undefined ? Infinity : Number(value("--limit"));
if (!(limit > 0) || (limit !== Infinity && !Number.isSafeInteger(limit)))
  throw new Error("--limit must be a positive integer");
const root = resolve(".local/destination-photos");
await mkdir(root, { recursive: true });
const detailsPath = resolve("scripts/place-details.json");
const { places } = JSON.parse(
  await readFile("public/data/places.json", "utf8"),
);
if (
  !Array.isArray(places) ||
  places.some((place) => !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(place.id)) ||
  new Set(places.map((place) => place.id)).size !== places.length
)
  throw new Error("Catalogue IDs must be unique safe filenames");
const details = JSON.parse(await readFile(detailsPath, "utf8"));
async function optionalJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}
const report = await optionalJson(`${root}/report.json`, {
  version: 1,
  places: {},
});
const identitySource = await optionalJson(`${root}/wikidata-owned.json`, null);
if (report.version !== 1 || !report.places || Array.isArray(report.places))
  throw new Error(
    "Unsupported photo report; keep it and inspect before retrying",
  );
async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function photoExists(place) {
  const image = details[place.id]?.image || place.image;
  if (!image) return false;
  if (!image.startsWith("/photos/")) return true;
  return exists(resolve("src/assets/destinations", image.split("/").at(-1)));
}
async function summary() {
  const covered = (await Promise.all(places.map(photoExists))).filter(
    Boolean,
  ).length;
  const entries = Object.values(report.places);
  return {
    total: places.length,
    withPhoto: covered,
    missing: places.length - covered,
    searched: entries.length,
    needsReview: entries.filter((p) => p.status === "needs-review").length,
    unavailable: entries.filter((p) => p.status === "unavailable").length,
    errors: entries.filter((p) => p.status === "error").length,
  };
}
if (args.includes("--status")) {
  console.log(JSON.stringify(await summary(), null, 2));
  process.exit(0);
}
const selected = value("--place");
if (selected && !places.some((place) => place.id === selected))
  throw new Error("Unknown --place ID");
const matches = value("--reviewed")
  ? JSON.parse(await readFile(value("--reviewed"), "utf8"))
  : await optionalJson(resolve("scripts/destination-photo-matches.json"), {});
for (const [id, match] of Object.entries(matches)) {
  if (!places.some((place) => place.id === id))
    throw new Error(`Unknown destination photo match: ${id}`);
  if (typeof match === "string") continue;
  if (
    !match ||
    typeof match !== "object" ||
    (match.alt !== undefined && typeof match.alt !== "string") ||
    (match.author !== undefined && typeof match.author !== "string") ||
    (match.aliases !== undefined &&
      (!Array.isArray(match.aliases) ||
        match.aliases.some((alias) => typeof alias !== "string")))
  )
    throw new Error(`Invalid destination photo match: ${id}`);
}
const reviewed = Object.fromEntries(
  Object.entries(matches)
    .map(([id, match]) => [
      id,
      typeof match === "string" ? match : match.fileTitle,
    ])
    .filter(([, title]) => title !== undefined),
);
for (const [id, title] of Object.entries(reviewed))
  if (
    !places.some((place) => place.id === id) ||
    typeof title !== "string" ||
    !title.startsWith("File:")
  )
    throw new Error(
      "Reviewed selections must map catalogue IDs to Commons File: titles",
    );
const priority = value("--priority-state")
  ? JSON.parse(await readFile(value("--priority-state"), "utf8"))
  : null;
// Only destination IDs are used; no home coordinates or visit data are sent upstream.
const priorities = new Set(
  (priority?.homeJourneys || []).flatMap((home) =>
    (home.queue || []).map((route) => route.placeId),
  ),
);
const ordered = places
  .filter((place) => !selected || place.id === selected)
  .map((place) => ({
    ...place,
    photoAliases: matches[place.id]?.aliases || [],
  }))
  .sort((a, b) => Number(priorities.has(b.id)) - Number(priorities.has(a.id)));
const lockPath = `${root}/import.lock`;
let lock;
try {
  lock = await open(lockPath, "wx");
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  const pid = Number(await readFile(lockPath, "utf8"));
  if (!Number.isSafeInteger(pid) || pid <= 0)
    throw new Error("Invalid import lock; inspect it before removal");
  let running = true;
  try {
    process.kill(pid, 0);
  } catch (failure) {
    if (failure.code === "ESRCH") running = false;
    else throw failure;
  }
  if (running) throw new Error(`Photo import ${pid} is already running`);
  await unlink(lockPath);
  lock = await open(lockPath, "wx");
}
await lock.writeFile(String(process.pid));
async function atomicJson(path, data) {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, JSON.stringify(data, null, 2) + "\n");
  await rename(temporary, path);
}
let lastRequest = 0;
async function request(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await wait(Math.max(0, 1200 - (Date.now() - lastRequest)));
    lastRequest = Date.now();
    let response;
    let target = new URL(url);
    for (let redirects = 0; redirects <= 3; redirects++) {
      if (
        target.protocol !== "https:" ||
        target.username ||
        target.password ||
        ![
          "commons.wikimedia.org",
          "upload.wikimedia.org",
          "thumb.wikimedia.org",
        ].includes(target.hostname)
      )
        throw new Error("Untrusted photo service redirect");
      response = await fetch(target, {
        redirect: "manual",
        signal: AbortSignal.timeout(30000),
        headers: {
          "User-Agent":
            "EverOutward/0.1 (destination photo library; https://github.com/SamMackrill/EverOutward)",
        },
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location || redirects === 3)
        throw new Error("Photo service redirect limit exceeded");
      target = new URL(location, target);
    }
    if ([429, 503].includes(response.status) && attempt < 3) {
      const seconds = Number(response.headers.get("retry-after"));
      await response.body?.cancel();
      await wait(
        Math.min(
          60000,
          Math.max(
            5000 * (attempt + 1),
            Number.isFinite(seconds) ? seconds * 1000 : 0,
          ),
        ),
      );
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`HTTP ${response.status}`);
    }
    return response;
  }
}
let processed = 0,
  serviceFailures = 0;
try {
  await mkdir(resolve("src/assets/destinations"), { recursive: true });
  for (const place of ordered) {
    if (await photoExists(place)) continue;
    if (details[place.id]?.image || place.image) {
      report.places[place.id] = {
        name: place.name,
        status: "error",
        error:
          "Existing photograph is missing from disk; repair it without replacing its credits",
      };
      continue;
    }
    const previous = report.places[place.id];
    const identityData = await optionalJson(
      `${root}/identity-${place.id}.json`,
      null,
    );
    if (
      !reviewed[place.id] &&
      !identityData &&
      (await exists(`${root}/nearby-${place.id}.json`)) &&
      !args.includes("--retry-missing") &&
      ["unavailable", "needs-review"].includes(previous?.status)
    )
      continue;
    if (processed >= limit) break;
    processed++;
    const entry = {
      name: place.name,
      checkedAt: new Date().toISOString(),
      status: "error",
    };
    report.places[place.id] = entry;
    try {
      const cachePath = `${root}/${place.id}.json`;
      let data =
        !reviewed[place.id] && !args.includes("--retry-missing")
          ? await optionalJson(cachePath, null)
          : null;
      if (!data) {
        data = await (
          await request(searchUrl(place, reviewed[place.id]))
        ).json();
        if (data.error)
          throw new Error(
            `Commons API: ${data.error.code}: ${data.error.info}`,
          );
        await atomicJson(cachePath, data);
      }
      const identity = photoIdentity(
        place,
        identitySource?.results?.bindings || [],
      );
      const candidates = (data.query?.pages || []).map((page) => ({
        fileTitle: page.title,
        ...(matchesIdentityCategory(page, identity)
          ? { identity: identity.entity }
          : {}),
        ...assessCandidate(place, page, {
          reviewed:
            !!reviewed[place.id] &&
            page.title.replace(/_/g, " ") ===
              reviewed[place.id].replace(/_/g, " "),
          reviewedAuthor: matches[place.id]?.author,
          identified: matchesIdentityCategory(page, identity),
        }),
      }));
      if (identityData) {
        // Revalidate the cached identity rather than trusting a hand-edited flag.
        const page = identityData.query?.pages?.find(
          (page) =>
            page.title.replace(/_/g, " ") ===
            identity?.fileTitle.replace(/_/g, " "),
        );
        if (page)
          candidates.unshift({
            fileTitle: page.title,
            identity: identity.entity,
            ...assessCandidate(place, page, { identified: true }),
          });
      }
      entry.candidates = candidates;
      let usable = candidates
        .filter((candidate) => candidate.accepted)
        .sort((a, b) => b.score - a.score);
      if (!usable.length && !reviewed[place.id]) {
        const nearbyCache = `${root}/nearby-${place.id}.json`;
        let nearby = !args.includes("--retry-missing")
          ? await optionalJson(nearbyCache, null)
          : null;
        if (!nearby) {
          nearby = await (await request(nearbySearchUrl(place))).json();
          if (nearby.error)
            throw new Error(`Commons nearby search: ${nearby.error.info}`);
          await atomicJson(nearbyCache, nearby);
        }
        for (const page of nearby.query?.pages || []) {
          const previousIndex = candidates.findIndex(
            (candidate) => candidate.fileTitle === page.title,
          );
          if (previousIndex >= 0 && candidates[previousIndex].accepted)
            continue;
          const identified = matchesIdentityCategory(page, identity);
          const candidate = {
            fileTitle: page.title,
            nearby: true,
            ...(identified ? { identity: identity.entity } : {}),
            ...assessCandidate(place, page, { identified }),
          };
          if (previousIndex >= 0) candidates[previousIndex] = candidate;
          else candidates.push(candidate);
        }
        usable = candidates
          .filter((candidate) => candidate.accepted)
          .sort((a, b) => b.score - a.score);
      }
      let saved = false;
      for (const candidate of usable) {
        try {
          const image = await readPhoto(await request(candidate.download));
          // Check for an assignment made while the download was in flight.
          const current = JSON.parse(await readFile(detailsPath, "utf8"));
          if (current[place.id]?.image)
            throw new Error(
              "Photo assigned while import was running; existing entry preserved",
            );
          const filename = `library-${place.id}.jpg`;
          const imagePath = resolve("src/assets/destinations", filename);
          const temporary = `${imagePath}.tmp-${process.pid}`;
          await writeFile(temporary, image);
          await rename(temporary, imagePath);
          const patch = {
            image: `/photos/${filename}`,
            imageAuthor: candidate.author,
            imageSource: candidate.source,
            imageLicence: candidate.licence.label,
            imageLicenceUrl: candidate.licence.url,
            imageAlt: matches[place.id]?.alt || candidate.title,
            ...(candidate.attribution &&
            candidate.attribution !== candidate.author
              ? { imageAttribution: candidate.attribution }
              : {}),
            ...(new URL(candidate.download).pathname.includes("/thumb/")
              ? { imageChanges: "Resized for display." }
              : {}),
          };
          current[place.id] = { ...current[place.id], ...patch };
          await atomicJson(detailsPath, current);
          details[place.id] = current[place.id];
          entry.status = "saved";
          entry.selected = candidate.fileTitle;
          entry.bytes = image.length;
          saved = true;
          break;
        } catch (error) {
          candidate.downloadError = error.message;
        }
      }
      if (!saved) {
        entry.status = usable.length
          ? "error"
          : candidates.length
            ? "needs-review"
            : "unavailable";
        if (usable.length)
          entry.error =
            "No candidate could be downloaded; inspect candidate download errors";
      }
      serviceFailures = 0;
    } catch (error) {
      entry.error = error.message;
      serviceFailures++;
    }
    await atomicJson(`${root}/report.json`, report);
    console.log(
      `${processed}. ${place.name}: ${entry.status}${entry.error ? ` (${entry.error})` : ""}`,
    );
    if (serviceFailures >= 3)
      throw new Error(
        "Three consecutive source failures; progress saved. Retry when the service recovers.",
      );
  }
  report.updatedAt = new Date().toISOString();
  report.summary = await summary();
  await atomicJson(`${root}/report.json`, report);
  const missing = [];
  for (const place of places) {
    if (await photoExists(place)) continue;
    const entry = report.places[place.id];
    missing.push({
      id: place.id,
      name: place.name,
      status: entry?.status || "not-searched",
      ...(matches[place.id]?.note
        ? {
            reviewNote: matches[place.id].note,
            evidence: matches[place.id].evidence || [],
          }
        : {}),
      ...(entry?.error ? { error: entry.error } : {}),
      reasons: [
        ...new Set(
          (entry?.candidates || [])
            .filter((candidate) => !candidate.accepted)
            .map((candidate) => candidate.reason),
        ),
      ],
    });
  }
  await atomicJson(resolve("scripts/destination-photo-coverage.json"), {
    checkedAt: report.updatedAt,
    summary: report.summary,
    missing,
  });
  console.log(JSON.stringify(report.summary, null, 2));
} finally {
  await lock.close();
  await unlink(lockPath);
}

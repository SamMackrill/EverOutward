import express from "express";
import { z } from "zod";
import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import {
  publicVisit,
  sortVisits,
  outward,
  publicRange,
  routeMatchesPlace,
} from "./domain.mjs";
import { cloudRecords, cloudRequest, siteState } from "./herenow.mjs";
import { createPublishJobs } from "./publish-jobs.mjs";
import { visitPublicationStatus } from "./publish-journal.mjs";
import {
  applyPlaceCorrections,
  publicPlaceOverrides,
  distanceReviewRows,
  reviewRevision,
  saveReviewedRoute,
} from "./distance-review.mjs";
import { refreshDrivingRoutes } from "./routing.mjs";
import {
  currentHome,
  homeJourneys,
  homeRoutes,
  liveHomes,
  migrateHomes,
  originFor,
  publicJournal,
  routeKey,
} from "./homes.mjs";
import { MAX_VISIT_PHOTOS, resolvePhotoAlbum } from "./photo-albums.mjs";
import {
  photoSource,
  resolvePhotoLink,
  resolveMissingPhotoPreviews,
} from "./photo-links.mjs";

const url = z
  .string()
  .url()
  .max(2000)
  .refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "Use an HTTPS link.");
const photo = z
  .object({
    id: z.string().min(1),
    url: z.union([url, z.literal("")]),
    caption: z.string().trim().max(300),
    kind: z.enum(["image", "album", "shared"]),
    previewUrl: z
      .union([
        url,
        z
          .string()
          .max(750000)
          .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/),
        z.literal(""),
      ])
      .optional(),
  })
  .refine(
    (p) => !!p.url || !!p.previewUrl,
    "Add a shared link or a display photo.",
  );
export const visitSchema = z
  .object({
    placeId: z.string(),
    startingHomeId: z.string().min(1).optional(),
    startingHomeVersion: z.string().min(1).optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(
        (value) =>
          new Date(value + "T12:00:00Z").toISOString().slice(0, 10) === value,
        "Enter a valid date.",
      ),
    title: z.string().trim().max(120),
    summary: z.string().trim().max(280),
    notes: z.string().trim().max(8000),
    attendees: z
      .array(z.string().trim().min(1).max(80))
      .max(30)
      .default([])
      .refine(
        (names) =>
          new Set(names.map((n) => n.toLocaleLowerCase("en-GB"))).size ===
          names.length,
        "List each person once.",
      ),
    rating: z.number().int().min(1).max(5).nullable(),
    photos: z
      .array(photo)
      .max(MAX_VISIT_PHOTOS)
      .refine(
        (p) => JSON.stringify(p).length <= 8_000_000,
        "The display photos exceed 8 MB. Use shared links or fewer display copies.",
      ),
    coverId: z.string().nullable(),
    published: z.boolean(),
    updatedAt: z.string().optional(),
  })
  .refine(
    (v) =>
      !v.coverId ||
      v.photos.some((p) => p.id === v.coverId && !!photoSource(p)),
    "Choose a photo with a display preview belonging to this visit as the cover.",
  )
  .refine(
    (v) => new Set(v.photos.map((p) => p.id)).size === v.photos.length,
    "Each photo must have a unique ID.",
  );
const commentSchema = z.object({
  visitId: z.string(),
  photoId: z.string().nullable(),
  name: z.string().trim().min(1, "Enter your name.").max(80),
  body: z.string().trim().min(1, "Write a comment.").max(2000),
  website: z.string().max(0).optional(),
});

export function createApp({
  store,
  places,
  initialHome = null,
  enableCloud = true,
  localOwner = false,
  publisher,
  autoPublish = enableCloud,
  routeFetcher = fetch,
}) {
  const app = express(),
    sessions = new Map(),
    limits = new Map();
  const placeIds = new Set(places.map((p) => p.id));
  const cataloguePlaces = places;
  const correctedPlaces = () =>
    applyPlaceCorrections(cataloguePlaces, store.list("placeCorrections"));
  if (
    !store.get("settings", "homesSchema") &&
    !store.get("settings", "home") &&
    initialHome
  )
    store.put("settings", "home", initialHome);
  migrateHomes(store);
  const publishJobs = publisher || createPublishJobs({ store });
  const publishCorrection = () =>
    autoPublish
      ? publishJobs.enqueue
        ? publishJobs.enqueue()
        : publishJobs.start()
      : null;
  app.disable("x-powered-by");
  app.use(express.json({ limit: "10mb" }));
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!["GET", "HEAD"].includes(req.method)) {
      const allowed = new Set(
        [
          "http://127.0.0.1:5173",
          "http://localhost:5173",
          "http://127.0.0.1:3001",
          "http://localhost:3001",
          process.env.APP_ORIGIN,
        ].filter(Boolean),
      );
      if (
        !allowed.has(req.headers.origin) ||
        req.headers["x-everoutward"] !== "1"
      )
        return res
          .status(403)
          .json({ error: "Request origin is not permitted." });
    }
    const cookie = (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("eo_session="))
      ?.slice(11);
    const session = sessions.get(cookie);
    req.owner = localOwner || (!!session && session.expires > Date.now());
    next();
  });
  const owner = (req, res, next) =>
    req.owner
      ? next()
      : res
          .status(401)
          .json({ error: "Sign in to the local owner workspace." });
  const rateLimit = (key, count, duration) => {
    const now = Date.now();
    let l = limits.get(key);
    if (!l || l.until < now) {
      l = { count: 0, until: now + duration };
      limits.set(key, l);
    }
    if (++l.count > count)
      throw Object.assign(
        new Error("Too many attempts. Please try again later."),
        { status: 429 },
      );
  };
  app.get("/api/session", (req, res) =>
    res.json({
      local: true,
      localOwner,
      owner: req.owner,
      passwordConfigured: !!store.get("settings", "owner"),
    }),
  );
  app.post("/api/login", (req, res) => {
    rateLimit(`login:${req.ip}`, 10, 15 * 60000);
    const password = z
      .string()
      .min(12, "Use at least 12 characters.")
      .max(200)
      .parse(req.body.password);
    let account = store.get("settings", "owner");
    if (!account) {
      const salt = randomBytes(16).toString("hex");
      account = { salt, hash: scryptSync(password, salt, 64).toString("hex") };
      store.put("settings", "owner", account);
    }
    if (
      !timingSafeEqual(
        Buffer.from(account.hash, "hex"),
        scryptSync(password, account.salt, 64),
      )
    )
      return res
        .status(401)
        .json({ error: "The owner password is incorrect." });
    const token = randomBytes(32).toString("hex");
    sessions.set(token, { expires: Date.now() + 12 * 3600000 });
    res.cookie("eo_session", token, {
      httpOnly: true,
      sameSite: "strict",
      maxAge: 12 * 3600000,
      path: "/",
    });
    res.json({ ok: true });
  });
  app.post("/api/logout", (req, res) => {
    const token = (req.headers.cookie || "").match(/eo_session=([^;]+)/)?.[1];
    sessions.delete(token);
    res.clearCookie("eo_session");
    res.json({ ok: true });
  });
  app.post("/api/photo-links/preview", owner, async (req, res) => {
    rateLimit(`photo-preview:${req.ip}`, 30, 60000);
    const link = url.parse(req.body.url);
    res.json(await resolvePhotoLink(link));
  });
  app.post("/api/photo-links/album", owner, async (req, res) => {
    rateLimit(`photo-album:${req.ip}`, 10, 60000);
    const link = url.parse(req.body.url);
    try {
      res.json(await resolvePhotoAlbum(link));
    } catch (error) {
      res.status(422).json({ error: error.message });
    }
  });
  app.get("/api/state", (req, res) => {
    const places = correctedPlaces();
    const visits = sortVisits(store.list("visits"));
    const home = currentHome(store);
    const homes = liveHomes(store);
    const allHomes = store.list("homes");
    const routes = store.list("routes");
    const shared = publicJournal(
      places,
      visits,
      allHomes,
      routes,
      home?.id || null,
    );
    if (!req.owner)
      return res.json({
        ...shared,
        placeOverrides: publicPlaceOverrides(store.list("placeCorrections")),
        home: null,
        routes: [],
        homes: [],
        homeJourneys: shared.homes,
      });
    res.json({
      ...shared,
      placeOverrides: publicPlaceOverrides(store.list("placeCorrections")),
      visits: visits.map((visit) => ({
        ...visit,
        startingHomeLabel: publicVisit(visit, allHomes).startingHomeLabel,
        publicationStatus: visitPublicationStatus(
          visit,
          store.get("settings", "lastPublication"),
          allHomes,
        ),
      })),
      home,
      homes,
      activeHomeId: home?.id || null,
      routes: routes.filter(
        (r) =>
          homes.some((h) => h.id === r.homeId && h.version === r.homeVersion) &&
          places.some((p) => p.id === r.placeId && routeMatchesPlace(r, p)),
      ),
      homeJourneys: homeJourneys(
        places,
        visits,
        homes,
        routes,
        store.list("routeReports"),
      ),
      revision: store.get("settings", "revision")?.value || 0,
      outward: outward(places, visits, home, homeRoutes(store, home)),
    });
  });
  const bump = () =>
    store.put("settings", "revision", {
      value: (store.get("settings", "revision")?.value || 0) + 1,
    });
  const visitOrigin = (data, old = null) => {
    if (
      old?.startingHomeId &&
      (!data.startingHomeId || data.startingHomeId === old.startingHomeId)
    )
      return {
        startingHomeId: old.startingHomeId,
        startingHomeVersion: old.startingHomeVersion,
        startingHomeSnapshot: old.startingHomeSnapshot,
      };
    if (!data.startingHomeId)
      throw new Error("Choose the starting home for this trip.");
    const home = store.get("homes", data.startingHomeId);
    if (!home || home.archivedAt)
      throw new Error(
        "This starting home was removed. Choose another location.",
      );
    if (data.startingHomeVersion && data.startingHomeVersion !== home.version)
      throw new Error(
        "This home moved while the visit was open. Reload and check the trip origin.",
      );
    return originFor(home);
  };
  const checkOrigin = (origin, old = null) => {
    if (old?.startingHomeId === origin.startingHomeId) return;
    const home = store.get("homes", origin.startingHomeId);
    if (!home || home.archivedAt || home.version !== origin.startingHomeVersion)
      throw new Error(
        "The starting home changed while saving. Reload and choose the trip origin again.",
      );
  };
  app.post("/api/visits", owner, async (req, res) => {
    const data = visitSchema.parse(req.body);
    const origin = visitOrigin(data);
    if (!placeIds.has(data.placeId))
      throw new Error("Select a known National Trust place.");
    data.photos = await resolveMissingPhotoPreviews(data.photos);
    checkOrigin(origin);
    const stamp = new Date().toISOString();
    const visit = {
      ...data,
      ...origin,
      id: randomUUID(),
      createdAt: stamp,
      updatedAt: stamp,
    };
    store.put("visits", visit.id, visit);
    bump();
    res.status(201).json({ visit });
  });
  app.put("/api/visits/:id", owner, async (req, res) => {
    const old = store.get("visits", req.params.id);
    if (!old) return res.status(404).json({ error: "Visit not found." });
    const data = visitSchema.parse(req.body);
    const origin = visitOrigin(data, old);
    if (data.updatedAt !== old.updatedAt)
      return res
        .status(409)
        .json({ error: "This visit changed. Reload before editing." });
    if (!placeIds.has(data.placeId)) throw new Error("Select a known place.");
    data.photos = await resolveMissingPhotoPreviews(data.photos);
    if (store.get("visits", req.params.id)?.updatedAt !== old.updatedAt)
      return res.status(409).json({
        error:
          "This visit changed while loading photos. Reload before editing.",
      });
    checkOrigin(origin, old);
    const visit = {
      ...old,
      ...data,
      ...origin,
      updatedAt: new Date().toISOString(),
    };
    store.put("visits", visit.id, visit);
    bump();
    res.json({ visit });
  });
  app.delete("/api/visits/:id", owner, (req, res) => {
    store.delete("visits", req.params.id);
    for (const c of store
      .list("comments")
      .filter((c) => c.visitId === req.params.id))
      store.delete("comments", c.id);
    bump();
    res.json({ ok: true });
  });
  app.patch("/api/visits/:id/publication", owner, (req, res) => {
    const data = z
      .object({ published: z.boolean(), updatedAt: z.string() })
      .parse(req.body);
    const visit = store.transaction(() => {
      const previous = store.get("visits", req.params.id);
      if (!previous)
        throw Object.assign(new Error("Visit not found."), { status: 404 });
      if (data.updatedAt !== previous.updatedAt)
        throw Object.assign(
          new Error(
            "This visit changed. Reload before changing its publishing choice.",
          ),
          { status: 409 },
        );
      const visit = {
        ...previous,
        published: data.published,
        updatedAt: new Date().toISOString(),
      };
      store.put("visits", visit.id, visit);
      bump();
      return visit;
    });
    res.json({ visit });
  });
  const homeSchema = z.object({
    label: z.string().trim().min(1, "Give this home a name.").max(120),
    colour: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default("#007a3b"),
    lat: z.number().min(49).max(61),
    lng: z.number().min(-9).max(3),
  });
  const saveHome = (data, previous = null) => {
    const home = {
      ...previous,
      ...data,
      id: previous?.id || randomUUID(),
      version:
        previous?.lat === data.lat && previous?.lng === data.lng
          ? previous.version
          : randomUUID(),
      archivedAt: null,
      createdAt: previous?.createdAt || new Date().toISOString(),
    };
    store.put("homes", home.id, home);
    if (!currentHome(store))
      store.put("settings", "activeHomeId", { value: home.id });
    bump();
    return home;
  };
  const requireHome = (id) => {
    const home = store.get("homes", id || "");
    if (!home || home.archivedAt)
      throw new Error("Choose an available home location.");
    return home;
  };
  app.post("/api/homes", owner, (req, res) => {
    const data = homeSchema.parse(req.body);
    const home = store.transaction(() => saveHome(data));
    res.status(201).json({ home });
  });
  app.patch("/api/homes/:id", owner, (req, res) => {
    const home = store.transaction(() => {
      const previous = requireHome(req.params.id);
      if (
        req.body.expectedVersion &&
        req.body.expectedVersion !== previous.version
      )
        throw Object.assign(
          new Error(
            "This home moved while the editor was open. Reload before saving.",
          ),
          { status: 409 },
        );
      return saveHome(homeSchema.parse({ ...previous, ...req.body }), previous);
    });
    res.json({ home });
  });
  app.put("/api/homes/current", owner, (req, res) => {
    store.transaction(() => {
      const home = requireHome(req.body.homeId);
      store.put("settings", "activeHomeId", { value: home.id });
      bump();
    });
    res.json({ home: currentHome(store) });
  });
  app.delete("/api/homes/:id", owner, (req, res) => {
    store.transaction(() => {
      const home = requireHome(req.params.id);
      if (liveHomes(store).length < 2)
        throw new Error("Add another home before removing the last location.");
      if (currentHome(store)?.id === home.id) {
        const replacement = requireHome(req.body?.replacementId);
        if (replacement.id === home.id)
          throw new Error("Choose a different current home.");
        store.put("settings", "activeHomeId", { value: replacement.id });
      }
      store.put("homes", home.id, {
        ...home,
        archivedAt: new Date().toISOString(),
      });
      bump();
    });
    res.json({ ok: true });
  });
  // Compatibility for existing local clients; the Workspace uses /api/homes.
  app.put("/api/home", owner, (req, res) => {
    const home = store.transaction(() =>
      saveHome(
        homeSchema.parse({ ...currentHome(store), ...req.body }),
        currentHome(store),
      ),
    );
    res.json({ home });
  });
  app.get("/api/postcode", owner, async (req, res) => {
    const postcode = z.string().trim().min(5).max(10).parse(req.query.q);
    const response = await fetch(
      `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`,
      { signal: AbortSignal.timeout(10000) },
    );
    const data = await response.json();
    if (!response.ok)
      return res.status(400).json({
        error: "Postcode not found. You can enter coordinates instead.",
      });
    res.json({
      label: data.result.postcode,
      lat: data.result.latitude,
      lng: data.result.longitude,
    });
  });
  app.put("/api/routes", owner, (req, res) => {
    const home = requireHome(req.body.homeId || currentHome(store)?.id);
    if (req.body.homeVersion && req.body.homeVersion !== home.version)
      throw new Error("Home moved. Reload before saving distances.");
    const rows = z
      .array(
        z.object({
          placeId: z.string(),
          metres: z.number().finite().min(0).max(10000000),
          seconds: z.number().finite().min(0).max(1000000),
        }),
      )
      .max(1000)
      .parse(req.body.routes);
    if (rows.some((r) => !placeIds.has(r.placeId)))
      throw new Error("The route file contains an unknown place ID.");
    store.transaction(() => {
      for (const r of rows)
        saveReviewedRoute(
          store,
          home,
          correctedPlaces().find((p) => p.id === r.placeId),
          { ...r, source: "Owner-entered Waze route" },
        );
    });
    res.json({ imported: rows.length, job: publishCorrection() });
  });
  app.get("/api/comments/:visitId", async (req, res) => {
    const visit = store.get("visits", req.params.visitId);
    if (!visit || (!req.owner && !visit.published))
      return res.status(404).json({ error: "Visit not found." });
    const comments = store
      .list("comments")
      .filter((c) => c.visitId === visit.id);
    let cloudError = "";
    if (enableCloud)
      try {
        const cloud = await cloudRecords("comments");
        comments.push(
          ...cloud
            .filter(
              (r) =>
                r.data.visit_id === visit.id &&
                r.data.name?.trim() &&
                r.data.body?.trim(),
            )
            .map((r) => ({
              id: r.id,
              visitId: r.data.visit_id,
              photoId: r.data.photo_id || null,
              name: r.data.name,
              body: r.data.body,
              createdAt: r.createdAt || r.created_at,
              cloud: true,
            })),
        );
      } catch {
        cloudError = "Public comments could not be loaded. Try again.";
      }
    res.json({ comments, cloudError });
  });
  app.post("/api/comments", async (req, res) => {
    const data = commentSchema.parse(req.body);
    const visit = store.get("visits", data.visitId);
    if (
      !visit?.published ||
      (data.photoId && !visit.photos.some((p) => p.id === data.photoId))
    )
      return res
        .status(404)
        .json({ error: "This comment target is unavailable." });
    const key = String(req.headers["idempotency-key"] || randomUUID()).slice(
        0,
        100,
      ),
      prior = store.get("comment-requests", key);
    if (prior) return res.status(201).json(prior);
    rateLimit(`comment:${req.ip}`, 10, 3600000);
    const site = enableCloud ? await siteState() : {};
    let c;
    if (site.slug) {
      const result = await cloudRequest(
        `/api/v1/publishes/${site.slug}/data/comments`,
        {
          method: "POST",
          headers: { "Idempotency-Key": key },
          body: JSON.stringify({
            visit_id: data.visitId,
            photo_id: data.photoId || "",
            name: data.name,
            body: data.body,
          }),
        },
      );
      c = {
        ...data,
        id: result.record.id,
        createdAt: result.record.createdAt || result.record.created_at,
        cloud: true,
      };
    } else {
      c = { ...data, id: randomUUID(), createdAt: new Date().toISOString() };
      store.put("comments", c.id, c);
    }
    const result = { comment: c };
    store.put("comment-requests", key, result);
    res.status(201).json(result);
  });
  app.delete("/api/comments/:id", owner, async (req, res) => {
    if (req.query.cloud === "1" && enableCloud) {
      const { slug } = await siteState();
      if (!slug) throw new Error("No published site is connected.");
      await cloudRequest(
        `/api/v1/publishes/${slug}/data/comments/${encodeURIComponent(req.params.id)}`,
        { method: "DELETE" },
      );
    } else store.delete("comments", req.params.id);
    res.json({ ok: true });
  });
  app.get("/api/export", owner, (req, res) => {
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="ever-outward-backup.json"',
    );
    res.json({
      version: 2,
      exportedAt: new Date().toISOString(),
      visits: store.list("visits"),
      comments: store.list("comments"),
      home: currentHome(store),
      homes: store.list("homes"),
      activeHomeId: currentHome(store)?.id || null,
      routeReports: store.list("routeReports"),
      legacyRoutes: store.list("legacyRoutes"),
      placeCorrections: store.list("placeCorrections"),
      routeReviews: store.list("routeReviews"),
      routeHistory: store.list("routeHistory"),
      placeCorrectionHistory: store.list("placeCorrectionHistory"),
      routes: store.list("routes"),
    });
  });
  app.get("/api/site", owner, async (req, res) => {
    const s = await siteState();
    res.json({
      siteUrl: s.siteUrl || null,
      publishedAt: s.publishedAt || null,
    });
  });
  let routing = false;
  app.get("/api/distance-review", owner, (req, res) => {
    const home = requireHome(req.query.homeId || currentHome(store)?.id);
    res.json({
      home,
      rows: distanceReviewRows(store, home, correctedPlaces()),
    });
  });
  const reviewSchema = z.object({
    homeId: z.string(),
    homeVersion: z.string(),
    revision: z.string(),
    action: z.enum(["manual", "retry", "entrance", "flag"]),
    metres: z.number().finite().positive().max(10000000).optional(),
    seconds: z.number().finite().positive().max(1000000).optional(),
    source: z.string().trim().min(1).max(180).optional(),
    note: z.string().trim().max(2000).default(""),
    reason: z.string().trim().min(1).max(600).optional(),
    entrance: z
      .object({
        lat: z.number().finite().min(49).max(61),
        lng: z.number().finite().min(-9).max(3),
      })
      .optional(),
    publicNote: z.string().trim().max(600).default(""),
    sourceUrl: url.optional(),
  });
  app.post("/api/distance-review/:placeId", owner, async (req, res) => {
    const data = reviewSchema.parse(req.body),
      home = requireHome(data.homeId);
    if (routing)
      throw new Error("Wait for the current distance calculation to finish.");
    const place = correctedPlaces().find((p) => p.id === req.params.placeId);
    if (!place) throw new Error("Choose a catalogue place.");
    const check = () => {
      if (
        requireHome(home.id).version !== data.homeVersion ||
        reviewRevision(
          store,
          home,
          correctedPlaces().find((p) => p.id === place.id),
        ) !== data.revision
      )
        throw Object.assign(
          new Error(
            "This home, route or entrance changed. Reopen its review before saving.",
          ),
          { status: 409 },
        );
    };
    const outcomes = [];
    if (data.action === "manual") {
      if (!data.metres || !data.seconds || !data.source)
        throw new Error("Enter the verified distance, travel time and source.");
      store.transaction(() => {
        check();
        saveReviewedRoute(store, home, place, data);
      });
    } else if (data.action === "flag") {
      if (!data.reason) throw new Error("Describe what needs checking.");
      store.transaction(() => {
        check();
        const key = routeKey(home, place.id),
          route = store.get("routes", key);
        if (route) store.put("routes", key, { ...route, reviewRequired: true });
        store.put("routeReviews", key, {
          homeId: home.id,
          homeVersion: home.version,
          placeId: place.id,
          open: true,
          reason: data.reason,
          note: data.note,
          updatedAt: new Date().toISOString(),
        });
      });
    } else {
      if (data.action === "entrance") {
        if (!data.entrance || !data.sourceUrl)
          throw new Error(
            "Set the visitor entrance and provide the page used to verify it.",
          );
        store.transaction(() => {
          check();
          const old = store.get("placeCorrections", place.id);
          if (old) store.put("placeCorrectionHistory", randomUUID(), old);
          store.put("placeCorrections", place.id, {
            placeId: place.id,
            version: randomUUID(),
            entrance: data.entrance,
            publicNote: data.publicNote,
            sourceUrl: data.sourceUrl,
            reviewNote: data.note,
            reviewedAt: new Date().toISOString(),
          });
          for (const h of liveHomes(store))
            store.put("routeReviews", routeKey(h, place.id), {
              homeId: h.id,
              homeVersion: h.version,
              placeId: place.id,
              open: true,
              reason:
                "The visitor entrance changed. This home needs a fresh route.",
              note: data.note,
              updatedAt: new Date().toISOString(),
            });
        });
      } else
        store.transaction(() => {
          check();
          const key = routeKey(home, place.id),
            old = store.get("routeReviews", key);
          store.put("routeReviews", key, {
            ...old,
            homeId: home.id,
            homeVersion: home.version,
            placeId: place.id,
            open: !!old?.open,
            note: data.note,
            updatedAt: new Date().toISOString(),
          });
        });
      routing = true;
      try {
        for (const h of data.action === "entrance"
          ? liveHomes(store)
          : [home]) {
          try {
            const result = await refreshDrivingRoutes({
              store,
              places: correctedPlaces(),
              homeId: h.id,
              onlyPlaceIds: [place.id],
              force: true,
              reviewed: true,
              fetcher: routeFetcher,
            });
            const failed = result.unavailablePlaces.find(
              (p) => p.placeId === place.id,
            );
            outcomes.push({
              home: h.label,
              resolved: !failed,
              error: failed?.reason,
            });
          } catch (error) {
            outcomes.push({
              home: h.label,
              resolved: false,
              error: error.message,
            });
          }
        }
      } finally {
        routing = false;
      }
    }
    res.json({ outcomes, job: publishCorrection() });
  });
  app.get("/api/publish", owner, (req, res) =>
    res.json({ job: publishJobs.status() }),
  );
  app.post(
    ["/api/routes/refresh", "/api/homes/:id/routes/refresh"],
    owner,
    async (req, res) => {
      if (routing || publishJobs.status()?.status === "running")
        return res.status(409).json({
          error: "A route calculation or publish is already running.",
        });
      routing = true;
      const routesBefore = JSON.stringify(store.list("routes"));
      try {
        const result = await refreshDrivingRoutes({
          store,
          places: correctedPlaces(),
          homeId: req.params.id || currentHome(store)?.id,
        });
        res.json({
          ...result,
          job:
            JSON.stringify(store.list("routes")) !== routesBefore
              ? publishCorrection()
              : null,
        });
      } catch (error) {
        if (JSON.stringify(store.list("routes")) !== routesBefore)
          publishCorrection();
        throw error;
      } finally {
        routing = false;
      }
    },
  );
  app.post("/api/publish", owner, (req, res) => {
    if (routing)
      return res.status(409).json({
        error: "Wait for the distance calculation to finish before publishing.",
      });
    res.status(202).json({ job: publishJobs.start() });
  });
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(error.status || (error instanceof z.ZodError ? 400 : 400)).json({
      error:
        error instanceof z.ZodError
          ? error.issues[0].message
          : error.message || "Request failed.",
    });
  });
  return app;
}

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Map,
  Route as RouteIcon,
  Clock3,
  BookOpen,
  ArrowUpRight,
  ChevronRight,
  ArrowLeft,
  Plus,
  Search,
  Settings,
  LogIn,
  LogOut,
  Check,
  MapPin,
  Download,
  LoaderCircle,
  Globe,
  Home as HomeIcon,
  Users,
  Monitor,
  Sun,
  Moon,
} from "lucide-react";
import MapPanel, { type MapCommand } from "./MapPanel";
import NextFive, { NextGateCompact } from "./NextFive";
import JourneyBar from "./JourneyBar";
import HomeLocations from "./HomeLocations";
import DistanceReview from "./DistanceReview";
import BoatNotice from "./BoatNotice";
import Modal from "./Modal";
import VisitEditor from "./VisitEditor";
import VisitDetail from "./VisitDetail";
import RouteEditor from "./RouteEditor";
import {
  EmptyPhoto,
  PhotoCredit,
  PhotoImage,
  Stars,
  WalkingEstimate,
} from "./shared";
import { date, duration, miles, shortDate } from "./format";
import { enrichCatalogue } from "./catalogue";
import { photoSource } from "../server/photo-links.mjs";
import * as api from "./api";
import { haversine, outward, sortVisits, wazeLink } from "../server/domain.mjs";
import type {
  Home,
  HomeJourney,
  Place,
  Route,
  Session,
  Visit,
  VisitRange,
} from "./types";

const timelinePhoto = (v: Visit) =>
  v.photos.find((p) => p.id === v.coverId && photoSource(p)) ||
  v.photos.find((p) => photoSource(p));
const official = (p: Place) =>
  p.officialUrl ||
  `https://www.nationaltrust.org.uk/search?query=${encodeURIComponent(p.name)}`;
/** Renders the owner workspace or public journal and coordinates application state. */
export default function App() {
  const [cataloguePlaces, setPlaces] = useState<Place[]>([]),
    [placeOverrides, setPlaceOverrides] = useState<
      (Partial<Place> & { id: string })[]
    >([]),
    [visits, setVisits] = useState<Visit[]>([]),
    [home, setHome] = useState<Home | null>(null),
    [publicRange, setPublicRange] = useState<VisitRange | null>(null),
    [allRoutes, setRoutes] = useState<Route[]>([]),
    [homes, setHomes] = useState<Home[]>([]),
    [homeJourneys, setHomeJourneys] = useState<HomeJourney[]>([]),
    [activeHomeId, setActiveHomeId] = useState<string | null>(null),
    [session, setSession] = useState<Session>({
      local: false,
      owner: false,
      passwordConfigured: true,
    });
  const places = useMemo(() => {
    const corrections = new globalThis.Map(
      placeOverrides.map((p) => [p.id, p]),
    );
    return cataloguePlaces.map((p) => ({ ...p, ...corrections.get(p.id) }));
  }, [cataloguePlaces, placeOverrides]);
  const [publicQueue, setPublicQueue] = useState<Route[]>([]),
    [publicComplete, setPublicComplete] = useState(false),
    [publicPending, setPublicPending] = useState(0);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [query, setQuery] = useState(""),
    [placeQuery, setPlaceQuery] = useState("");
  const [view, setView] = useState(location.hash.slice(1) || "map"),
    [selected, setSelected] = useState<Place | null>(null),
    [editor, setEditor] = useState<Visit | "new" | null>(null),
    [editorPlace, setEditorPlace] = useState<string>(),
    [showLogin, setShowLogin] = useState(false),
    [pendingPhotoVisit, setPendingPhotoVisit] = useState<string | null>(() =>
      new URLSearchParams(location.search).get("addPhotos"),
    ),
    [editorFocus, setEditorFocus] = useState<"photos" | "story">(),
    [routePlace, setRoutePlace] = useState<Place | null>(null);
  const [themeChoice, setThemeChoice] = useState(() => {
      try {
        return localStorage.getItem("eo-theme") || "system";
      } catch {
        return "system";
      }
    }),
    [systemDark, setSystemDark] = useState(
      matchMedia("(prefers-color-scheme: dark)").matches,
    );
  const [command, setCommand] = useState<MapCommand>({
      kind: "next",
      serial: 0,
    }),
    [timelineLimit, setTimelineLimit] = useState(20);
  const theme =
    themeChoice === "system" ? (systemDark ? "dark" : "light") : themeChoice;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("eo-theme", themeChoice);
    } catch {}
  }, [theme, themeChoice]);
  useEffect(() => {
    const m = matchMedia("(prefers-color-scheme: dark)"),
      f = () => setSystemDark(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  const reload = useCallback(async () => {
    const s = await api.session();
    setSession(s);
    const d = await api.state();
    setVisits(d.visits);
    setPlaceOverrides(d.placeOverrides || []);
    setHome(d.home);
    setHomes(d.homes || []);
    setHomeJourneys(d.homeJourneys || []);
    setActiveHomeId(d.activeHomeId || null);
    setPublicRange(d.range || null);
    setRoutes(d.routes);
    setPublicQueue(d.queue || []);
    setPublicComplete(!!d.complete);
    setPublicPending(d.pendingCount || 0);
  }, []);
  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("/data/places.json", { cache: "no-store" }).then((r) => {
        if (!r.ok)
          throw new Error(
            "The places catalogue could not be loaded. Please refresh.",
          );
        return r.json();
      }),
      reload(),
    ])
      .then(([catalogue]) => {
        if (alive) setPlaces(enrichCatalogue(catalogue.places));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    return () => {
      alive = false;
    };
  }, [reload]);
  useEffect(() => {
    if (loading || !session.local || !pendingPhotoVisit) return;
    if (!session.owner) {
      setShowLogin(true);
      return;
    }
    const visit = visits.find((v) => v.id === pendingPhotoVisit);
    if (visit) {
      setEditorFocus("photos");
      setEditor(visit);
    } else
      setError(
        "This visit is not in this computer’s journal. Open the owner workspace where it was recorded.",
      );
    setPendingPhotoVisit(null);
    const url = new URL(location.href);
    url.searchParams.delete("addPhotos");
    history.replaceState(history.state, "", url);
  }, [loading, session.local, session.owner, pendingPhotoVisit, visits]);
  useEffect(() => {
    const f = () => setView(location.hash.slice(1) || "map");
    window.addEventListener("popstate", f);
    return () => window.removeEventListener("popstate", f);
  }, []);
  useEffect(() => {
    setCommand({ kind: "next", serial: Date.now() });
  }, [home?.version, activeHomeId]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  const timelineFocus = useRef<HTMLElement | null>(null),
    timelineScroll = useRef(0);
  useEffect(() => {
    if (view === "timeline" && timelineFocus.current) {
      requestAnimationFrame(() => {
        timelineFocus.current?.focus({ preventScroll: true });
        window.scrollTo(0, timelineScroll.current);
      });
    }
  }, [view]);
  const navigate = (next: string) => {
    if (view === "timeline" && next.startsWith("visit/")) {
      timelineFocus.current = document.activeElement as HTMLElement;
      timelineScroll.current = window.scrollY;
    }
    history.pushState({ from: view }, "", `#${next}`);
    setView(next);
    // Pages scroll with the window, so a new page starts at its top. Going
    // back to the timeline restores its position separately.
    if (next !== "timeline") window.scrollTo(0, 0);
  };
  const routes = useMemo(
    () =>
      session.owner
        ? allRoutes.filter(
            (r) => r.homeId === home?.id && r.homeVersion === home?.version,
          )
        : [
            ...new globalThis.Map(
              [
                ...publicQueue,
                ...(homeJourneys.find((h) => h.id === activeHomeId)
                  ?.reviewedRoutes || []),
              ].map((r) => [r.placeId, r]),
            ).values(),
          ],
    [allRoutes, home, session.owner, homeJourneys, activeHomeId, publicQueue],
  );
  async function chooseHome(id: string) {
    try {
      if (session.owner) {
        await api.request("/api/homes/current", {
          method: "PUT",
          body: JSON.stringify({ homeId: id }),
        });
        await reload();
      } else {
        const selected = homeJourneys.find((h) => h.id === id);
        if (!selected) return;
        setActiveHomeId(id);
        setPublicQueue(selected.queue);
        setPublicRange(selected.range);
        setPublicComplete(selected.complete);
        setPublicPending(selected.pendingCount);
      }
    } catch (e) {
      setToast((e as Error).message);
    }
  }
  const visited = useMemo(
    () => new Set(visits.map((v) => v.placeId)),
    [visits],
  );
  const progress = useMemo(() => {
    const result = outward(places, visits, home, routes);
    if (!session.owner) {
      result.ranked = publicQueue.map((r) => ({
        ...places.find((p) => p.id === r.placeId)!,
        ...r,
      }));
      result.complete = publicComplete;
      result.pendingCount = publicPending;
      result.blockingPendingCount = publicPending;
    }
    return result;
  }, [
    places,
    visits,
    home,
    routes,
    session.owner,
    publicQueue,
    publicComplete,
    publicPending,
  ]);
  const mapRange: VisitRange | null =
    session.owner && home
      ? {
          centre: home,
          radius: progress.radius,
          confirmed: progress.rangeComplete,
          approximate: false,
        }
      : publicRange;
  const placeList = useMemo(
    () =>
      places.filter((p) =>
        `${p.name} ${p.region}`
          .toLowerCase()
          .includes(placeQuery.toLowerCase()),
      ),
    [places, placeQuery],
  );
  const nearby = useMemo(
    () =>
      home
        ? [...places]
            .filter((p) => !visited.has(p.id))
            .sort((a, b) => haversine(home, a) - haversine(home, b))
            .slice(0, 5)
        : [],
    [places, visited, home],
  );
  const historyVisits = useMemo(
    () =>
      sortVisits(visits).filter((v: Visit) => {
        const p = places.find((p) => p.id === v.placeId);
        return (
          !query ||
          `${p?.name} ${v.title} ${v.summary} ${v.notes} ${(v.attendees || []).join(" ")}`
            .toLowerCase()
            .includes(query.toLowerCase())
        );
      }) as Visit[],
    [visits, places, query],
  );
  const currentVisit = view.startsWith("visit/")
    ? visits.find((v) => v.id === view.slice(6))
    : null;
  const onSelect = useCallback((place: Place) => setSelected(place), []);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || view !== "timeline") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting)
          setTimelineLimit((n) => Math.min(n + 20, historyVisits.length));
      },
      { rootMargin: "300px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [view, historyVisits.length, timelineLimit]);
  const saveVisit = async (
    value: Omit<Visit, "id" | "createdAt" | "updatedAt"> & {
      updatedAt?: string;
    },
  ) => {
    await api.request(
      editor === "new" ? "/api/visits" : "/api/visits/" + (editor as Visit).id,
      {
        method: editor === "new" ? "POST" : "PUT",
        body: JSON.stringify(value),
      },
    );
    await reload();
    setEditor(null);
    setEditorFocus(undefined);
    setToast(
      "Visit saved to your local journal. Publish when you’re ready to share.",
    );
  };
  const placeVisits = selected
    ? sortVisits(visits.filter((v) => v.placeId === selected.id))
    : [];
  /** Opens the visit editor for a new visit, optionally with a place chosen. */
  const openEditor = (placeId?: string) => {
    setEditorPlace(placeId);
    setEditorFocus(undefined);
    setEditor("new");
  };
  const selectOnMap = (p: Place) => {
    setSelected(p);
    navigate("map");
    setCommand({ kind: "place", id: p.id, serial: Date.now() });
  };
  if (loading)
    return (
      <div className="loading-page">
        <img src="/icons/gate.svg" alt="" />
        <h1>Ever Outward</h1>
        <LoaderCircle className="spin" />
        <p>Opening the next gate…</p>
      </div>
    );
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <a
          className="brand"
          href="#map"
          onClick={(e) => {
            e.preventDefault();
            navigate("map");
          }}
        >
          <img src="/icons/gate.svg" alt="" />
          <span>
            <strong>Ever Outward</strong>
            <small>THE NEXT GATE</small>
          </span>
        </a>
        <nav aria-label="Main navigation">
          <button
            className={view === "map" ? "active" : ""}
            onClick={() => navigate("map")}
          >
            <Map size={17} />
            Map
          </button>
          <button
            className={
              view === "timeline" || view.startsWith("visit/") ? "active" : ""
            }
            onClick={() => navigate("timeline")}
          >
            <BookOpen size={17} />
            Our timeline
          </button>
          {session.owner && (
            <button
              className={view === "settings" ? "active" : ""}
              onClick={() => navigate("settings")}
            >
              <Settings size={17} />
              Workspace
            </button>
          )}
        </nav>
        <div className="header-actions">
          <div
            className="theme-picker"
            role="radiogroup"
            aria-label="Colour theme"
          >
            {[
              { value: "system", label: "System theme", Icon: Monitor },
              { value: "light", label: "Light theme", Icon: Sun },
              { value: "dark", label: "Dark theme", Icon: Moon },
            ].map(({ value, label, Icon }) => (
              <label className="theme-option" key={value} title={label}>
                <input
                  type="radio"
                  name="colour-theme"
                  value={value}
                  aria-label={label}
                  checked={themeChoice === value}
                  onChange={() => setThemeChoice(value)}
                />
                <span>
                  <Icon size={17} aria-hidden="true" />
                </span>
              </label>
            ))}
          </div>
          {session.local &&
            !session.localOwner &&
            (session.owner ? (
              <button
                className="icon-button"
                aria-label="Sign out"
                onClick={async () => {
                  await api.request("/api/logout", { method: "POST" });
                  await reload();
                  navigate("map");
                }}
              >
                <LogOut size={19} />
              </button>
            ) : (
              <button
                className="button quiet"
                onClick={() => setShowLogin(true)}
              >
                <LogIn size={16} />
                Owner sign-in
              </button>
            ))}
        </div>
      </header>
      <JourneyBar
        title={
          view === "map"
            ? progress.ranked[0]?.name || "Your next gate"
            : undefined
        }
        nextGate={progress.ranked[0]}
        progress={{
          visited: visited.size,
          total: places.length,
          days: visits.length,
          range: mapRange,
        }}
        owner={session.owner}
        onRecord={() => openEditor()}
        onNextGate={() => selectOnMap(progress.ranked[0])}
      />
      {error && (
        <div role="alert" className="error-banner">
          {error}
          <button onClick={() => location.reload()}>Retry</button>
        </div>
      )}
      <main
        id="main"
        className={`workspace ${view === "map" ? "workspace-map" : "workspace-page"}`}
      >
        <section className="main-pane">
          {view === "map" && progress.ranked[0] && (
            <NextGateCompact
              place={progress.ranked[0]}
              onSelect={() => selectOnMap(progress.ranked[0])}
            />
          )}
          <MapPanel
            hidden={view !== "map"}
            places={places}
            visits={visits}
            routes={routes}
            visited={visited}
            nextId={progress.complete ? progress.ranked[0]?.id : undefined}
            nextIds={progress.ranked.map((p: Place) => p.id)}
            home={home}
            homeJourneys={homeJourneys}
            activeHomeId={activeHomeId}
            range={mapRange}
            theme={theme}
            selectedId={selected?.id}
            command={command}
            onCommand={(kind) => setCommand({ kind, serial: Date.now() })}
            onSelect={onSelect}
            onFind={(p) => {
              setSelected(p);
              setCommand({ kind: "place", id: p.id, serial: Date.now() });
            }}
            onChooseHome={chooseHome}
            onBrowseList={() => navigate("places")}
          />
          <div
            className="timeline-view content-scroll"
            hidden={view !== "timeline"}
          >
            <div className="section-heading">
              <h1 className="view-title">Our days beyond the gate</h1>
              <span className="count-label">
                {visits.length} {visits.length === 1 ? "visit" : "visits"}
              </span>
            </div>
            <label className="search timeline-search">
              <Search size={18} />
              <input
                aria-label="Search visit history"
                placeholder="Find a memory or person…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setTimelineLimit(20);
                }}
              />
            </label>
            {!historyVisits.length ? (
              <div className="empty-state">
                <img src="/icons/gate.svg" alt="" />
                <h3>
                  {query
                    ? "No matching memories"
                    : "Every story starts with a first visit"}
                </h3>
                <p>
                  {query
                    ? "Try another place name or word from your journal."
                    : "The walks, the gardens, the unexpected discoveries. They’ll all find a home here."}
                </p>
                {session.owner && (
                  <button
                    className="button primary"
                    onClick={() => openEditor()}
                  >
                    <Plus size={17} />
                    Record your first visit
                  </button>
                )}
              </div>
            ) : (
              <div className="timeline-list">
                {historyVisits.slice(0, timelineLimit).map((v, index) => {
                  const p = places.find((p) => p.id === v.placeId),
                    photo = timelinePhoto(v),
                    month = v.date.slice(0, 7),
                    prev = historyVisits[index - 1]?.date.slice(0, 7);
                  return (
                    <div key={v.id}>
                      {month !== prev && (
                        <h3 className="month-label">
                          {new Date(v.date + "T12:00:00").toLocaleDateString(
                            "en-GB",
                            { month: "long", year: "numeric" },
                          )}
                        </h3>
                      )}
                      <article className="visit-card">
                        <button
                          className="visit-image"
                          onClick={() => navigate("visit/" + v.id)}
                          aria-label={`Read visit to ${p?.name} on ${date(v.date)}`}
                        >
                          {photo ? (
                            <PhotoImage photo={photo} />
                          ) : (
                            <EmptyPhoto />
                          )}
                        </button>
                        <div>
                          <p className="eyebrow">
                            {date(v.date)}
                            {session.owner
                              ? ` · ${v.publicationStatus || (v.published ? "Ready to publish" : "Only on this computer")}`
                              : ""}
                          </p>
                          <h3>
                            <button
                              className="title-button"
                              onClick={() => navigate("visit/" + v.id)}
                            >
                              {v.title || p?.name}
                            </button>
                          </h3>
                          {v.title && <p className="small muted">{p?.name}</p>}
                          <Stars value={v.rating} />
                          <BoatNotice place={p} />
                          <p className="visit-origin">
                            <HomeIcon size={13} />
                            Started from{" "}
                            {v.startingHomeLabel ||
                              v.startingHomeSnapshot?.label ||
                              "location not recorded"}
                          </p>
                          {!!v.attendees?.length && (
                            <p className="attendee-list">
                              <Users size={14} />
                              <span>With {v.attendees.join(", ")}</span>
                            </p>
                          )}
                          {(v.summary || v.notes.trim()) && (
                            <p>{v.summary || v.notes.slice(0, 220)}</p>
                          )}
                          <button
                            className="text-button"
                            onClick={() => navigate("visit/" + v.id)}
                          >
                            Read the full visit <ChevronRight size={15} />
                          </button>
                        </div>
                      </article>
                    </div>
                  );
                })}
              </div>
            )}
            <div ref={sentinel} />
            {historyVisits.length > timelineLimit ? (
              <button
                className="button"
                onClick={() => setTimelineLimit((n) => n + 20)}
              >
                Load older visits
              </button>
            ) : historyVisits.length > 0 ? (
              <p className="timeline-end">
                You’ve reached your first visit. Here’s to the next one.
              </p>
            ) : null}
          </div>
          {view === "places" && (
            <div className="content-scroll">
              <button className="text-button" onClick={() => navigate("map")}>
                <ArrowLeft size={17} />
                Back to map
              </button>
              <h1 className="view-title">All the places to explore</h1>
              <label className="search">
                <Search size={17} />
                <input
                  aria-label="Filter the places list"
                  placeholder="Search places"
                  value={placeQuery}
                  onChange={(e) => setPlaceQuery(e.target.value)}
                />
              </label>
              <div className="places-grid">
                {placeList.map((p) => (
                  <button
                    key={p.id}
                    className="place-row"
                    onClick={() => {
                      setSelected(p);
                    }}
                  >
                    <span
                      className={`place-number ${visited.has(p.id) ? "done" : ""}`}
                    >
                      {visited.has(p.id) ? (
                        <Check size={15} />
                      ) : (
                        <MapPin size={15} />
                      )}
                    </span>
                    <span>
                      <strong>{p.name}</strong>
                      <small>{p.region}</small>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                ))}
              </div>
            </div>
          )}
          {view.startsWith("visit/") &&
            (currentVisit ? (
              <VisitDetail
                visit={currentVisit}
                place={places.find((p) => p.id === currentVisit.placeId)!}
                owner={session.owner}
                onBack={() => {
                  if (history.state?.from) history.back();
                  else navigate("timeline");
                }}
                onMap={() =>
                  selectOnMap(
                    places.find((p) => p.id === currentVisit.placeId)!,
                  )
                }
                onEdit={(focus) => {
                  setEditorFocus(focus);
                  setEditor(currentVisit);
                }}
                onAddPhotos={() => {
                  setEditorFocus("photos");
                  setEditor(currentVisit);
                }}
                onDelete={async () => {
                  await api.request("/api/visits/" + currentVisit.id, {
                    method: "DELETE",
                  });
                  await reload();
                  navigate("timeline");
                  setToast(
                    "Visit removed. Publish to update the public journal.",
                  );
                }}
              />
            ) : (
              <div className="empty-state">
                <BookOpen />
                <h1 className="view-title">This visit isn’t available</h1>
                <p>It may be unpublished or have been removed.</p>
                <button className="button" onClick={() => navigate("timeline")}>
                  Back to timeline
                </button>
              </div>
            ))}
          {view === "settings" &&
            (session.owner ? (
              <Workspace
                visits={visits}
                home={home}
                homes={homes}
                homeJourneys={homeJourneys}
                routes={routes}
                places={places}
                onRefresh={reload}
                notify={setToast}
              />
            ) : (
              <div className="empty-state">
                <h1 className="view-title">Owner workspace</h1>
                <p>Sign in locally to manage your journey.</p>
                <button
                  className="button primary"
                  onClick={() => setShowLogin(true)}
                >
                  Sign in
                </button>
              </div>
            ))}
        </section>
        {view === "map" && (
          <NextFive
            progress={progress}
            hasQueue={publicQueue.length > 0}
            owner={session.owner}
            hasPlaces={places.length > 0}
            nearby={nearby}
            home={home}
            onSelect={selectOnMap}
            onNavigate={navigate}
          />
        )}
      </main>
      <footer className="site-footer">
        <span>Ever Outward: The Next Gate</span>
        <span>Independent family journal · National Trust data: CC BY 4.0</span>
      </footer>
      {selected && (
        <Modal title={selected.name} onClose={() => setSelected(null)}>
          <div className="place-detail">
            {selected.image && (
              <>
                <img
                  className="place-detail-photo"
                  src={selected.image}
                  alt={selected.imageAlt || selected.name}
                />
                <PhotoCredit place={selected} />
              </>
            )}
            <p className="eyebrow">{selected.region}</p>
            {session.owner && placeVisits.length > 0 && (
              <p className="visit-count">
                <Check size={15} />
                Visited{" "}
                {placeVisits.length === 1
                  ? "once"
                  : placeVisits.length === 2
                    ? "twice"
                    : `${placeVisits.length} times`}{" "}
                · last {shortDate(placeVisits[0].date)}
              </p>
            )}
            <BoatNotice place={selected} />
            <p>
              {selected.description ||
                `Explore this National Trust place in ${selected.region}. Check the official visitor information for facilities, access and seasonal arrangements.`}
            </p>
            <div className="info-row">
              <Clock3 size={18} />
              <span>
                {selected.hours || "Check official opening times"}
                <small>
                  Current hours and booking requirements are on the official
                  site.
                </small>
              </span>
            </div>
            {(home || routes.some((r) => r.placeId === selected.id)) && (
              <div className="info-row">
                <RouteIcon size={18} />
                <span>
                  {routes.find((r) => r.placeId === selected.id)
                    ? `${miles(routes.find((r) => r.placeId === selected.id)!.metres)} mi by road · ${duration(routes.find((r) => r.placeId === selected.id)!.seconds)}`
                    : "Driving distance and time not saved yet"}
                  {home && (
                    <small>
                      {miles(haversine(home, selected))} mi geographic distance
                      from home
                    </small>
                  )}
                </span>
              </div>
            )}
            <div className="button-row">
              <a
                className="button primary"
                href={wazeLink(selected)}
                target="_blank"
                rel="noreferrer"
              >
                Open Waze <ArrowUpRight size={16} />
              </a>
              <a
                className="button"
                href={official(selected)}
                target="_blank"
                rel="noreferrer"
              >
                Official visitor information <ArrowUpRight size={16} />
              </a>
            </div>
            <WalkingEstimate
              route={routes.find((r) => r.placeId === selected.id)}
              detail
            />
            <p className="small muted">
              {selected.entrance
                ? "Directions use the reviewed visitor entrance."
                : "The catalogue map point may differ from the visitor entrance. Check the destination in Waze before travelling."}
            </p>
            {selected.accessNote && (
              <p className="access-note">{selected.accessNote}</p>
            )}
            {session.owner && (
              <div className="button-row">
                <button
                  className="button"
                  onClick={() => {
                    setSelected(null);
                    openEditor(selected.id);
                  }}
                >
                  <Plus size={16} />
                  Record a visit here
                </button>
                <button
                  className="button"
                  onClick={() => {
                    setRoutePlace(selected);
                    setSelected(null);
                  }}
                >
                  Save Waze distance
                </button>
              </div>
            )}
            {placeVisits.length > 0 && (
              <section>
                <h3>Our visits here</h3>
                {placeVisits.map((v) => (
                  <button
                    className="place-row"
                    key={v.id}
                    onClick={() => {
                      setSelected(null);
                      navigate("visit/" + v.id);
                    }}
                  >
                    <span>{date(v.date)}</span>
                    <Stars value={v.rating} />
                    <ChevronRight size={16} />
                  </button>
                ))}
              </section>
            )}
          </div>
        </Modal>
      )}
      {showLogin && (
        <Login
          configured={session.passwordConfigured}
          onClose={() => {
            setShowLogin(false);
            setPendingPhotoVisit(null);
          }}
          onSuccess={async () => {
            await reload();
            setShowLogin(false);
            setToast("Welcome to your owner workspace.");
          }}
        />
      )}
      {editor && (
        <VisitEditor
          visit={editor === "new" ? null : editor}
          defaultPlace={editorPlace}
          homes={homes}
          currentHome={home}
          focus={editorFocus}
          places={places}
          onClose={() => {
            setEditor(null);
            setEditorFocus(undefined);
          }}
          onSave={saveVisit}
        />
      )}
      {routePlace && (
        <RouteEditor
          place={routePlace}
          onClose={() => setRoutePlace(null)}
          onSave={async (metres, seconds) => {
            await api.request("/api/routes", {
              method: "PUT",
              body: JSON.stringify({
                routes: [{ placeId: routePlace.id, metres, seconds }],
                homeId: home?.id,
                homeVersion: home?.version,
              }),
            });
            await reload();
            setRoutePlace(null);
            setToast("Driving distance saved. Publishing has been queued.");
          }}
        />
      )}
      {toast && (
        <div role="status" className="toast">
          <Check size={18} />
          {toast}
        </div>
      )}
    </>
  );
}

function Login({
  configured,
  onClose,
  onSuccess,
}: {
  configured: boolean;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.request("/api/login", {
        method: "POST",
        body: JSON.stringify({
          password: new FormData(e.currentTarget).get("password"),
        }),
      });
      await onSuccess();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={configured ? "Welcome back" : "Set up your owner workspace"}
      onClose={onClose}
    >
      <form onSubmit={submit} className="form-stack">
        <p>
          {configured
            ? "Your visits and home settings are managed on this computer."
            : "Create a password for editing visits and private home settings on this computer."}
        </p>
        <label>
          Owner password
          <input
            name="password"
            type="password"
            autoComplete={configured ? "current-password" : "new-password"}
            required
            minLength={12}
            autoFocus
          />
        </label>
        <p className="small muted">
          At least 12 characters. Your here.now account key is never sent to the
          browser.
        </p>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          {busy ? (
            <LoaderCircle className="spin" size={18} />
          ) : (
            <LogIn size={18} />
          )}{" "}
          {configured ? "Sign in" : "Create owner password"}
        </button>
      </form>
    </Modal>
  );
}

type PublishJob = {
  id: string;
  status: "running" | "succeeded" | "failed";
  message?: string;
  error?: string;
  result?: {
    siteUrl: string;
    publishedAt: string;
    pendingLocalChanges?: boolean;
    publishedVisitCount: number;
    warnings?: string[];
  };
};
function Workspace({
  visits,
  home,
  homes,
  homeJourneys,
  routes,
  places,
  onRefresh,
  notify,
}: {
  visits: Visit[];
  home: Home | null;
  homes: Home[];
  homeJourneys: HomeJourney[];
  routes: Route[];
  places: Place[];
  onRefresh: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const [error, setError] = useState(""),
    [submitting, setSubmitting] = useState(false),
    [job, setJob] = useState<PublishJob | null>(null),
    [connectionError, setConnectionError] = useState(""),
    [changingVisit, setChangingVisit] = useState(""),
    [pendingSelection, setPendingSelection] = useState<{
      id: string;
      included: boolean;
    } | null>(null),
    [calculating, setCalculating] = useState(false),
    [reviewSelection, setReviewSelection] = useState<{
      homeId: string;
      placeId: string;
      serial: number;
    } | null>(null),
    [site, setSite] = useState<{
      siteUrl: string | null;
      publishedAt: string | null;
    }>({ siteUrl: null, publishedAt: null });
  const busy = submitting || job?.status === "running";
  const finished = useRef("");
  useEffect(() => {
    api
      .request<typeof site>("/api/site")
      .then(setSite)
      .catch(() => {});
  }, []);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const { job: current } = await api.request<{ job: PublishJob | null }>(
          "/api/publish",
        );
        if (cancelled) return;
        setJob(current);
        setConnectionError("");
        if (current?.status === "succeeded" && current.result) {
          setSite(current.result);
          if (finished.current !== current.id) {
            finished.current = current.id;
            await onRefresh();
          }
        }
      } catch {
        if (!cancelled)
          setConnectionError(
            "Cannot reach the local server. Reconnecting to check publishing status…",
          );
      } finally {
        if (!cancelled) timer = setTimeout(poll, 1500);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [onRefresh]);
  async function publish() {
    setSubmitting(true);
    setError("");
    try {
      const result = await api.request<{ job: PublishJob }>("/api/publish", {
        method: "POST",
      });
      setJob(result.job);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <div className="content-scroll settings-view">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Local owner workspace</p>
          <h1 className="view-title">A home for your adventures</h1>
        </div>
        <Settings size={26} />
      </div>
      <HomeLocations
        homes={homes}
        currentId={home?.id || null}
        journeys={homeJourneys}
        onRefresh={onRefresh}
        notify={notify}
        onBusy={setCalculating}
        onReview={(homeId, placeId) =>
          setReviewSelection({ homeId, placeId, serial: Date.now() })
        }
      />
      <DistanceReview
        homes={homes}
        currentId={home?.id || null}
        places={places}
        selection={reviewSelection}
        onRefresh={onRefresh}
      />
      <section className="settings-section">
        <div>
          <h3>Your public here.now site</h3>
          <p>
            Publish your selected visits, cover photos and summaries. New guest
            comments appear immediately. Remove comments through the visit
            detail in this workspace. Publishing keeps your local notes and
            photos and makes a private backup first.
          </p>
          {site.siteUrl && (
            <a href={site.siteUrl} target="_blank" rel="noreferrer">
              Open public journal <ArrowUpRight size={15} />
            </a>
          )}
          {site.publishedAt && (
            <p className="small muted">
              Last published{" "}
              {new Date(site.publishedAt).toLocaleString("en-GB")}
            </p>
          )}
        </div>
        <div className="form-stack">
          <button
            className="button primary"
            onClick={publish}
            disabled={busy || calculating || !!changingVisit}
          >
            {busy ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <Globe size={18} />
            )}{" "}
            {busy ? "Publishing…" : "Publish journal to here.now"}
          </button>
          <div className="publish-status" role="status" aria-live="polite">
            {busy && (
              <p>
                {job?.message || "Starting publication…"} You can leave this
                page; publishing will continue.
              </p>
            )}
            {!busy && job?.status === "succeeded" && (
              <p>
                {job.result?.publishedVisitCount} visits published successfully.
                {job.result?.pendingLocalChanges
                  ? " Newer local edits are waiting for another publish."
                  : ""}
              </p>
            )}
            {job?.result?.warnings?.map((warning, i) => (
              <p key={i}>{warning}</p>
            ))}
            {connectionError && <p>{connectionError}</p>}
          </div>
          {(error || job?.status === "failed") && (
            <p role="alert" className="form-error">
              {error || job?.error} Your local visits are safe. You can retry
              publishing.
            </p>
          )}
          <p className="small">
            {visits.filter((v) => v.published).length} visits included ·{" "}
            {visits.filter((v) => !v.published).length} excluded from
            publishing.
          </p>
          <details className="publish-selection">
            <summary>Choose visits to publish</summary>
            <p className="small muted">
              Unchecked visits are kept on this computer. If a visit is already
              public, unchecking it removes it from the website the next time
              you publish.
            </p>
            {visits.map((visit) => (
              <label className="checkbox" key={visit.id}>
                <input
                  type="checkbox"
                  aria-label={`Include ${visit.title || places.find((p) => p.id === visit.placeId)?.name || "visit"} in next publish`}
                  checked={
                    pendingSelection?.id === visit.id
                      ? pendingSelection.included
                      : visit.published
                  }
                  disabled={busy || !!changingVisit}
                  onChange={async (e) => {
                    setChangingVisit(visit.id);
                    setPendingSelection({
                      id: visit.id,
                      included: e.target.checked,
                    });
                    setError("");
                    try {
                      await api.request(`/api/visits/${visit.id}/publication`, {
                        method: "PATCH",
                        body: JSON.stringify({
                          published: e.target.checked,
                          updatedAt: visit.updatedAt,
                        }),
                      });
                      await onRefresh();
                    } catch (error) {
                      setError((error as Error).message);
                    } finally {
                      setChangingVisit("");
                      setPendingSelection(null);
                    }
                  }}
                />
                <span>
                  {visit.title ||
                    places.find((p) => p.id === visit.placeId)?.name}
                  <small className="muted">
                    {date(visit.date)} · {visit.publicationStatus}
                  </small>
                </span>
              </label>
            ))}
          </details>
          <p className="small muted">
            Reuses this project’s dedicated site. Excluded visits, exact home
            coordinates and account credentials stay local.
          </p>
        </div>
      </section>
      <section className="settings-section">
        <div>
          <h3>Keep a copy of your memories</h3>
          <p>
            Download your complete local history, photo links, comments, home
            and routes. Keep this backup private.
          </p>
        </div>
        <a className="button" href="/api/export">
          <Download size={18} />
          Export private backup
        </a>
      </section>
    </div>
  );
}

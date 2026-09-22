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
  X,
  Search,
  Settings,
  LogIn,
  LogOut,
  Check,
  MapPin,
  Camera,
  Download,
  LoaderCircle,
  Compass,
  Globe,
  Home as HomeIcon,
  Users,
  Monitor,
  Sun,
  Moon,
} from "lucide-react";
import MapView from "./MapView";
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
import { date, duration, miles } from "./format";
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
function DestinationCard({
  place,
  index,
  onSelect,
}: {
  place: Place & Route;
  index: number;
  onSelect: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setFailed(false);
    setRetry(0);
  }, [place.id, place.image]);
  return (
    <article
      className={`destination-card ${index === 0 ? "first-destination" : ""}`}
    >
      <button
        className="destination-photo"
        onClick={
          failed && place.image
            ? () => {
                setFailed(false);
                setRetry(Date.now());
              }
            : onSelect
        }
        aria-label={
          failed && place.image
            ? `Retry photo for ${place.name}`
            : `View ${place.name}`
        }
      >
        {place.image && !failed ? (
          <img
            src={
              retry
                ? `${place.image}${place.image.includes("?") ? "&" : "?"}retry=${retry}`
                : place.image
            }
            alt={place.imageAlt || place.name}
            loading={index === 0 ? "eager" : "lazy"}
            onError={() => setFailed(true)}
          />
        ) : (
          <span className="destination-no-photo">
            <Camera size={24} />
            {place.image ? "Photo could not load · Retry" : "Photo to follow"}
          </span>
        )}
        <span className="destination-number">{index + 1}</span>
        {index === 0 && <span className="next-gate-label">Your next gate</span>}
      </button>
      <div className="destination-copy">
        <h3>
          <button onClick={onSelect}>{place.name}</button>
        </h3>
        <p className="destination-distance">
          <RouteIcon size={13} />
          {miles(place.metres)} mi by road{" "}
          <span>· {duration(place.seconds)}</span>
        </p>
        <p className="destination-description">
          {place.description ||
            `Discover this National Trust place in ${place.region}.`}
        </p>
        <WalkingEstimate route={place} />
        <BoatNotice place={place} />
      </div>
      <PhotoCredit place={place} />
      {index === 0 && (
        <>
          <p className="destination-opening">{place.hours}</p>
          <a
            className="button primary destination-go"
            href={wazeLink(place)}
            target="_blank"
            rel="noreferrer"
          >
            Directions in Waze <ArrowUpRight size={15} />
          </a>
          <button className="text-button" onClick={onSelect}>
            Plan this visit <ChevronRight size={14} />
          </button>
        </>
      )}
    </article>
  );
}

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
    [filter, setFilter] = useState("all"),
    [showMapSearch, setShowMapSearch] = useState(false);
  const [view, setView] = useState(location.hash.slice(1) || "map"),
    [selected, setSelected] = useState<Place | null>(null),
    [editor, setEditor] = useState<Visit | "new" | null>(null),
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
  const [command, setCommand] = useState<{
      kind: "uk" | "home" | "place" | "next" | "homes";
      id?: string;
      serial: number;
    }>({ kind: "next", serial: 0 }),
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
        if (innerWidth <= 760) window.scrollTo(0, timelineScroll.current);
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
  const filtered = useMemo(
    () =>
      places.filter(
        (p) =>
          (filter === "all" ||
            (filter === "visited" ? visited.has(p.id) : !visited.has(p.id))) &&
          (!query ||
            `${p.name} ${p.region}`
              .toLowerCase()
              .includes(query.toLowerCase())),
      ),
    [places, visited, filter, query],
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
  const mapSearchToggle = useRef<HTMLButtonElement>(null);
  const closeMapSearch = () => {
    setShowMapSearch(false);
    setQuery("");
    setFilter("all");
    mapSearchToggle.current?.focus();
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
      <div className="journey-bar">
        <div>
          <span className="eyebrow">
            {view === "map"
              ? "Your next gate · nearest unvisited by road"
              : "A little further. A little more to remember."}
          </span>
          <h1>
            {view === "timeline"
              ? "Our days beyond the gate"
              : view === "settings"
                ? "Your journey, your way"
                : currentVisit
                  ? "A day to remember"
                  : progress.ranked[0]?.name || "Your next gate"}
          </h1>
        </div>
        <div className="journey-meta">
          {homeJourneys.length > 0 ? (
            <label className="home-switcher">
              <HomeIcon size={16} aria-hidden="true" />
              <span>Starting from</span>
              <select
                aria-label="Current home location"
                value={activeHomeId || ""}
                onChange={(e) => chooseHome(e.target.value)}
              >
                {homeJourneys.map((h) => (
                  <option value={h.id} key={h.id}>
                    {h.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="home-label">
              <Compass size={17} />
              England, Wales &amp; Northern Ireland
            </span>
          )}
          {session.owner && (
            <button className="button primary" onClick={() => setEditor("new")}>
              <Plus size={18} />
              Record a visit
            </button>
          )}
        </div>
      </div>
      {error && (
        <div role="alert" className="error-banner">
          {error}
          <button onClick={() => location.reload()}>Retry</button>
        </div>
      )}
      <main
        id="main"
        className={`workspace ${view === "settings" ? "workspace-settings" : ""} ${view === "map" ? "workspace-map" : ""}`}
      >
        <section className="main-pane">
          <div className="map-view" hidden={view !== "map"}>
            <div className="map-toolbar compact-toolbar">
              {showMapSearch ? (
                <div className="secondary-search">
                  <label className="search">
                    <Search size={18} />
                    <input
                      aria-label="Search National Trust places"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") closeMapSearch();
                      }}
                      placeholder="Place name"
                      autoFocus
                    />
                    {query && (
                      <button
                        aria-label="Clear search"
                        onClick={() => setQuery("")}
                      >
                        <X size={16} />
                      </button>
                    )}
                  </label>
                  <select
                    aria-label="Filter places"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="all">All places</option>
                    <option value="unvisited">Still to explore</option>
                    <option value="visited">Visited</option>
                  </select>
                </div>
              ) : (
                <span className="map-rule">
                  <Compass size={16} />
                  Shared discoveries. Distances from your current home.
                </span>
              )}
              <button
                ref={mapSearchToggle}
                className="text-button map-search-toggle"
                aria-expanded={showMapSearch}
                onClick={() => {
                  if (showMapSearch) return closeMapSearch();
                  setShowMapSearch(true);
                  setQuery("");
                  setFilter("all");
                }}
              >
                {showMapSearch ? (
                  <>
                    <X size={16} />
                    <span className="map-search-label">Close search</span>
                  </>
                ) : (
                  <>
                    <Search size={15} />
                    Find a place
                  </>
                )}
              </button>
            </div>
            <div className="map-container">
              <MapView
                places={filtered}
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
                onSelect={onSelect}
                command={command}
              />
              <div className="map-view-controls">
                {homeJourneys.length > 1 && (
                  <button
                    className="button"
                    onClick={() =>
                      setCommand({ kind: "homes", serial: Date.now() })
                    }
                  >
                    Show all home locations
                  </button>
                )}
                {progress.ranked.length > 0 && (
                  <button
                    onClick={() => {
                      setQuery("");
                      setFilter("all");
                      setCommand({ kind: "next", serial: Date.now() });
                    }}
                  >
                    <RouteIcon size={15} />
                    Next five
                  </button>
                )}
                <button
                  onClick={() => setCommand({ kind: "uk", serial: Date.now() })}
                >
                  <Globe size={15} />
                  Whole UK
                </button>
                {home && (
                  <button
                    onClick={() =>
                      setCommand({ kind: "home", serial: Date.now() })
                    }
                  >
                    <HomeIcon size={15} />
                    Around home
                  </button>
                )}
              </div>
              <div className="map-legend">
                <span>
                  <i className="dot unvisited" />
                  Still to explore
                </span>
                <span>
                  <i className="dot done" />
                  Visited
                </span>
                {mapRange && mapRange.radius > 0 && (
                  <span>
                    <i className="range-swatch" />
                    {mapRange.approximate
                      ? "Current circle · approximate"
                      : "Current discovery circle"}
                  </span>
                )}
                {homeJourneys.length > 1 && (
                  <span>
                    <i className="range-swatch other-home-swatch" />
                    Other homes · dashed
                  </span>
                )}
              </div>
              {query && (
                <div className="search-results">
                  <small>{filtered.length} places found</small>
                  {filtered.slice(0, 12).map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setSelected(p);
                        setCommand({
                          kind: "place",
                          id: p.id,
                          serial: Date.now(),
                        });
                      }}
                    >
                      {p.name}
                      <ChevronRight size={15} />
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="map-foot">
              <span>
                {filtered.length} catalogue places ·{" "}
                <a
                  href="https://services-eu1.arcgis.com/NPIbx47lsIiu2pqz/ArcGIS/rest/services/National_Trust_Visitor_Properties_/FeatureServer/0"
                  target="_blank"
                  rel="noreferrer"
                >
                  National Trust open data
                </a>
              </span>
              <button
                className="text-button"
                onClick={() => navigate("places")}
              >
                Browse accessible place list <ChevronRight size={14} />
              </button>
            </div>
          </div>
          <div
            className="timeline-view content-scroll"
            hidden={view !== "timeline"}
          >
            <div className="section-heading">
              <div>
                <p className="eyebrow">The places become memories</p>
                <h2>Our visit history</h2>
              </div>
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
                    onClick={() => setEditor("new")}
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
              <h2>All the places to explore</h2>
              <label className="search">
                <Search size={17} />
                <input
                  aria-label="Filter the places list"
                  placeholder="Search places"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <div className="places-grid">
                {filtered.map((p) => (
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
                <h2>This visit isn’t available</h2>
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
                <h2>Owner workspace</h2>
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
        {view !== "settings" && (
          <aside className="journey-sidebar">
            <div className="sidebar-head">
              <p className="eyebrow">One gate at a time</p>
              <h2>The next five</h2>
              <p>
                Our next adventure begins with the nearest place we haven’t
                visited.
              </p>
            </div>
            {progress.remainingCount === 0 && places.length > 0 ? (
              <div className="public-note">
                <Check size={28} />
                <h3>Every gate explored</h3>
                <p>
                  You’ve visited every place in the current catalogue. Your
                  memories are waiting in the timeline.
                </p>
              </div>
            ) : session.owner || publicQueue.length > 0 ? (
              <>
                {progress.ranked.length > 0 ? (
                  <>
                    <div
                      className={`route-status ${progress.complete ? "ready" : ""}`}
                    >
                      <RouteIcon size={17} />
                      <span>
                        {progress.complete
                          ? "Ranked by driving distance"
                          : "Saved routes · order still provisional"}
                      </span>
                    </div>
                    <div className="next-list destination-list">
                      {progress.ranked.map(
                        (p: Place & Route, index: number) => (
                          <DestinationCard
                            key={p.id}
                            place={p}
                            index={index}
                            onSelect={() => selectOnMap(p)}
                          />
                        ),
                      )}
                    </div>
                    <p className="route-note">
                      Estimated car routes ·{" "}
                      <a
                        href="https://routing.openstreetmap.de/about.html"
                        target="_blank"
                        rel="noreferrer"
                      >
                        OSRM / FOSSGIS
                      </a>{" "}
                      · ©{" "}
                      <a
                        href="https://www.openstreetmap.org/copyright"
                        target="_blank"
                        rel="noreferrer"
                      >
                        OpenStreetMap
                      </a>
                      . Times exclude live traffic. Check the visitor entrance
                      and opening days before travelling.{" "}
                      <a
                        href="https://www.openstreetmap.org/fixthemap"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Report a map issue
                      </a>
                      .
                    </p>
                  </>
                ) : (
                  <div className="route-setup">
                    <RouteIcon size={25} />
                    <h3>Your next gate is waiting</h3>
                    <p>
                      Calculate free driving estimates to find the nearest
                      unvisited places.
                    </p>
                    <button
                      className="text-button"
                      onClick={() => navigate("settings")}
                    >
                      Set up driving distances <ChevronRight size={15} />
                    </button>
                  </div>
                )}
                {!progress.complete && (
                  <p className="route-note">
                    {progress.blockingPendingCount} nearby unvisited places
                    still need a route. We won’t call a place “nearest” until
                    the ranking is complete.
                  </p>
                )}
              </>
            ) : (
              <div className="public-note">
                <Compass size={28} />
                <h3>A journey that grows from home</h3>
                <p>
                  We visit the nearest National Trust place we haven’t explored
                  yet. Follow the memories as our world gets a little wider.
                </p>
                <button className="button" onClick={() => navigate("timeline")}>
                  Explore our timeline <ChevronRight size={16} />
                </button>
              </div>
            )}
            <div className="stats">
              <div>
                <strong>{visited.size}</strong>
                <span>places visited</span>
              </div>
              <div>
                <strong>{visits.length}</strong>
                <span>days remembered</span>
              </div>
              {mapRange && (
                <div>
                  <strong>
                    {mapRange.approximate ? "≈ " : ""}
                    {miles(mapRange.radius)}
                    <small> mi</small>
                  </strong>
                  <span>
                    {mapRange.approximate
                      ? "approximate visit range"
                      : "visit range"}
                  </span>
                </div>
              )}
            </div>
            {session.owner && nearby.length > 0 && (
              <div className="nearby">
                <h3>Around your home</h3>
                <p className="small muted">
                  Straight-line discovery · not the driving queue
                </p>
                {nearby.map((p) => (
                  <button key={p.id} onClick={() => selectOnMap(p)}>
                    <span>{p.name}</span>
                    <span>{miles(haversine(home!, p))} mi</span>
                  </button>
                ))}
              </div>
            )}
            <div className="sidebar-footer">
              <img src="/icons/gate.svg" alt="" />
              <p>
                Collect days out.
                <br />
                Keep the little moments.
              </p>
            </div>
          </aside>
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
                    setEditor("new");
                  }}
                >
                  <Plus size={16} />
                  Record a visit
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
            {visits.filter((v) => v.placeId === selected.id).length > 0 && (
              <section>
                <h3>Our visits here</h3>
                {visits
                  .filter((v) => v.placeId === selected.id)
                  .map((v) => (
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
          defaultPlace={selected?.id}
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
          <h2>A home for your adventures</h2>
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

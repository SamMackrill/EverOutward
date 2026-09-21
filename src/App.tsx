import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
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
  Star,
  Camera,
  MessageCircle,
  Trash2,
  Pencil,
  Download,
  LoaderCircle,
  Compass,
  Globe,
  Home as HomeIcon,
  ImagePlus,
  Users,
  Monitor,
  Sun,
  Moon,
} from "lucide-react";
import MapView from "./MapView";
import { enrichCatalogue } from "./catalogue";
import VisitPhotoEditor, { PhotoLibraries } from "./VisitPhotoEditor";
import PhotoDropZone from "./PhotoDropZone";
import AlbumImport from "./AlbumImport";
import VisitCarousel from "./VisitCarousel";
import { MAX_VISIT_PHOTOS, photoIdentity } from "../server/photo-albums.mjs";
import {
  photoSource,
  providerFor,
  photoLinkIssue,
} from "../server/photo-links.mjs";
import * as api from "./api";
import { haversine, outward, sortVisits, wazeLink } from "../server/domain.mjs";
import type {
  Comment,
  Home,
  Photo,
  Place,
  Route,
  Session,
  Visit,
  VisitRange,
} from "./types";

const miles = (m: number) => (m / 1609.344).toFixed(1);
const duration = (seconds: number) =>
  seconds >= 3600
    ? `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`
    : `${Math.round(seconds / 60)} min`;
const date = (value: string) =>
  new Date(value + "T12:00:00").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
const timelinePhoto = (v: Visit) =>
  v.photos.find((p) => p.id === v.coverId && photoSource(p)) ||
  v.photos.find((p) => photoSource(p));
const official = (p: Place) =>
  p.officialUrl ||
  `https://www.nationaltrust.org.uk/search?query=${encodeURIComponent(p.name)}`;
function Stars({ value }: { value: number | null }) {
  return value ? (
    <span className="stars" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star size={13} key={i} fill={i <= value ? "currentColor" : "none"} />
      ))}
    </span>
  ) : null;
}
function EmptyPhoto({ small = false }: { small?: boolean }) {
  return (
    <div className={`empty-photo ${small ? "small" : ""}`}>
      <Camera size={small ? 22 : 32} />
      <span>No visit photo yet</span>
    </div>
  );
}
function PhotoImage({
  photo,
  className = "",
}: {
  photo: Photo;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const source = photoSource(photo);
  useEffect(() => setFailed(false), [source]);
  return failed || !source ? (
    <div className="empty-photo">
      <Camera />
      <span>{providerFor(photo.url)?.name || "Photo collection"}</span>
      <small>
        {failed
          ? "Preview unavailable · open original link"
          : photoLinkIssue(photo.url)
            ? "Google sharing link needed"
            : "Open the linked photos"}
      </small>
    </div>
  ) : (
    <img
      className={className}
      src={source}
      alt={photo.caption || "Photo from our visit"}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button
          aria-label="Close dialog"
          className="icon-button"
          onClick={onClose}
        >
          <X />
        </button>
      </header>
      {children}
    </dialog>
  );
}

function PhotoCredit({ place }: { place: Place }) {
  return place.imageSource ? (
    <p className="photo-credit">
      Photo:{" "}
      <a href={place.imageSource} target="_blank" rel="noreferrer">
        {place.imageAuthor}
      </a>{" "}
      ·{" "}
      <a href={place.imageLicenceUrl} target="_blank" rel="noreferrer">
        {place.imageLicence}
      </a>
    </p>
  ) : null;
}
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
  const [places, setPlaces] = useState<Place[]>([]),
    [visits, setVisits] = useState<Visit[]>([]),
    [home, setHome] = useState<Home | null>(null),
    [publicRange, setPublicRange] = useState<VisitRange | null>(null),
    [routes, setRoutes] = useState<Route[]>([]),
    [session, setSession] = useState<Session>({
      local: false,
      owner: false,
      passwordConfigured: true,
    });
  const [publicQueue, setPublicQueue] = useState<
      { placeId: string; metres: number; seconds: number }[]
    >([]),
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
    [focusEditorPhotos, setFocusEditorPhotos] = useState(false),
    [showPhotoAccess, setShowPhotoAccess] = useState(false),
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
      kind: "uk" | "home" | "place" | "next";
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
    setHome(d.home);
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
      setFocusEditorPhotos(true);
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
    if (home) setCommand({ kind: "home", serial: Date.now() });
  }, [home?.version]);
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
      ? { centre: home, radius: progress.radius, approximate: false }
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
    setFocusEditorPhotos(false);
    setToast(
      "Visit saved to your local journal. Publish when you’re ready to share.",
    );
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
          {session.owner && home ? (
            <span className="home-label">
              <HomeIcon size={16} />
              <span className="home-label-copy">
                <span>{home.label}</span>
                <span className="private-label">Private home base</span>
              </span>
            </span>
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
              <span className="map-rule">
                <Compass size={16} />
                One home base. Always the nearest unvisited place.
              </span>
              <button
                className="text-button map-search-toggle"
                aria-expanded={showMapSearch}
                onClick={() => {
                  setShowMapSearch((v) => !v);
                  setQuery("");
                  setFilter("all");
                }}
              >
                <Search size={15} />
                {showMapSearch ? "Close search" : "Find a place"}
              </button>
              {showMapSearch && (
                <div className="secondary-search">
                  <label className="search">
                    <Search size={18} />
                    <input
                      aria-label="Search National Trust places"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Place name"
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
              )}
            </div>
            <div className="map-container">
              <MapView
                places={filtered}
                visits={visits}
                routes={
                  session.owner
                    ? routes
                    : publicQueue.map((r) => ({
                        ...r,
                        homeVersion: "",
                        checkedAt: "",
                        source: "OSRM / FOSSGIS",
                      }))
                }
                visited={visited}
                nextId={progress.complete ? progress.ranked[0]?.id : undefined}
                nextIds={progress.ranked.map((p: Place) => p.id)}
                home={home}
                range={mapRange}
                theme={theme}
                selectedId={selected?.id}
                onSelect={onSelect}
                command={command}
              />
              <div className="map-view-controls">
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
                      ? "Approximate visit range"
                      : "Visit range"}
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
                            {!v.published ? " · Private draft" : ""}
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
                          {!!v.attendees?.length && (
                            <p className="attendee-list">
                              <Users size={14} />
                              <span>With {v.attendees.join(", ")}</span>
                            </p>
                          )}
                          <p>
                            {v.summary ||
                              v.notes.slice(0, 220) ||
                              "A new memory in our National Trust journey."}
                          </p>
                          <button
                            className="text-button"
                            onClick={() => navigate("visit/" + v.id)}
                          >
                            Read the full visit <ArrowUpRight size={15} />
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
                onEdit={() => {
                  setFocusEditorPhotos(false);
                  setEditor(currentVisit);
                }}
                onAddPhotos={() => {
                  if (session.local) setPendingPhotoVisit(currentVisit.id);
                  else setShowPhotoAccess(true);
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
                home={home}
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
                      Set up driving distances <ArrowUpRight size={15} />
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
                  Explore our timeline <ArrowUpRight size={16} />
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
            {home && (
              <div className="info-row">
                <RouteIcon size={18} />
                <span>
                  {routes.find((r) => r.placeId === selected.id)
                    ? `${miles(routes.find((r) => r.placeId === selected.id)!.metres)} mi by road · ${duration(routes.find((r) => r.placeId === selected.id)!.seconds)}`
                    : "Driving distance and time not saved yet"}
                  <small>
                    {miles(haversine(home, selected))} mi geographic distance
                    from home
                  </small>
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
            <p className="small muted">
              The catalogue map point may differ from the visitor entrance.
              Check the destination in Waze before travelling.
            </p>
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
      {showPhotoAccess && currentVisit && (
        <Modal
          title="Add photos to this visit"
          onClose={() => setShowPhotoAccess(false)}
        >
          <div className="form-stack">
            <p>
              Photos are added in your owner workspace on the computer where
              your journal is saved. This public page shows your published
              visits.
            </p>
            <a
              className="button primary"
              href={`http://127.0.0.1:3001/?addPhotos=${encodeURIComponent(currentVisit.id)}#visit/${encodeURIComponent(currentVisit.id)}`}
              target="_blank"
              rel="noreferrer"
            >
              Open this visit in owner workspace <ArrowUpRight size={16} />
            </a>
            <p className="small muted">
              Keep the local app running, then sign in if asked. The visit will
              open at its photo controls. On another device, open this link on
              your journal computer instead.
            </p>
          </div>
        </Modal>
      )}
      {editor && (
        <VisitEditor
          visit={editor === "new" ? null : editor}
          defaultPlace={selected?.id}
          focusPhotos={focusEditorPhotos}
          places={places}
          onClose={() => {
            setEditor(null);
            setFocusEditorPhotos(false);
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
              }),
            });
            await reload();
            setRoutePlace(null);
            setToast("Driving distance saved.");
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

function VisitEditor({
  focusPhotos = false,
  visit,
  defaultPlace,
  places,
  onClose,
  onSave,
}: {
  focusPhotos?: boolean;
  visit: Visit | null;
  defaultPlace?: string;
  places: Place[];
  onClose: () => void;
  onSave: (
    v: Omit<Visit, "id" | "createdAt" | "updatedAt"> & { updatedAt?: string },
  ) => Promise<void>;
}) {
  const [photos, setPhotos] = useState<Photo[]>(visit?.photos || []),
    [coverId, setCoverId] = useState<string | null>(visit?.coverId || null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const photoSection = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusPhotos) return;
    const frame = requestAnimationFrame(() => {
      photoSection.current?.scrollIntoView({ block: "start" });
      photoSection.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusPhotos]);
  const [photoJobs, setPhotoJobs] = useState<Set<string>>(new Set());
  const photoBusy = useCallback((id: string, active: boolean) => {
    setPhotoJobs((current) => {
      if (current.has(id) === active) return current;
      const next = new Set(current);
      if (active) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (photoJobs.size) return;
    if (JSON.stringify(photos).length > 8_000_000) {
      setError(
        "The display photos exceed 8 MB. Use shared links or fewer display copies.",
      );
      return;
    }
    setBusy(true);
    setError("");
    const d = new FormData(e.currentTarget);
    try {
      await onSave({
        placeId: String(d.get("placeId")),
        date: String(d.get("date")),
        title: String(d.get("title")),
        summary: String(d.get("summary")),
        notes: String(d.get("notes")),
        attendees: String(d.get("attendees") || "")
          .split(/[,\n]/)
          .map((name) => name.trim())
          .filter(Boolean),
        rating: d.get("rating") ? Number(d.get("rating")) : null,
        published: d.get("published") === "on",
        photos,
        coverId,
        updatedAt: visit?.updatedAt,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={visit ? "Edit this memory" : "Record a visit"}
      onClose={onClose}
      wide
    >
      <form className="form-stack" onSubmit={submit}>
        <div className="form-grid">
          <label>
            National Trust place
            <select
              name="placeId"
              defaultValue={visit?.placeId || defaultPlace || ""}
              required
            >
              <option value="">Choose a place</option>
              {[...places]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Visit date
            <input
              name="date"
              type="date"
              defaultValue={
                visit?.date || new Date().toLocaleDateString("en-CA")
              }
              required
            />
          </label>
        </div>
        <label>
          Who came along?{" "}
          <span className="optional">
            optional · separate names with commas
          </span>
          <input
            name="attendees"
            defaultValue={visit?.attendees?.join(", ") || ""}
            maxLength={2430}
            placeholder="Ana, Sam, Ele"
          />
        </label>
        <label>
          A title for the day <span className="optional">optional</span>
          <input
            name="title"
            maxLength={120}
            defaultValue={visit?.title}
            placeholder="A slow afternoon in the gardens"
          />
        </label>
        <label>
          Timeline summary
          <textarea
            name="summary"
            maxLength={280}
            rows={2}
            defaultValue={visit?.summary}
            placeholder="The little moments you want to remember…"
          />
        </label>
        <label>
          The full story
          <textarea
            name="notes"
            maxLength={8000}
            rows={5}
            defaultValue={visit?.notes}
            placeholder="What did you discover? What would you return for?"
          />
        </label>
        <div className="form-grid">
          <label>
            Your rating
            <select name="rating" defaultValue={visit?.rating || ""}>
              <option value="">Not rated</option>
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {"★".repeat(n)} · {n} / 5
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox">
            <input
              name="published"
              type="checkbox"
              defaultChecked={visit?.published ?? false}
            />
            Include in the public journal when published
          </label>
        </div>
        <div className="section-heading" ref={photoSection} tabIndex={-1}>
          <h3>Photo links</h3>
          <button
            className="button quiet"
            type="button"
            disabled={photos.length >= MAX_VISIT_PHOTOS}
            onClick={() =>
              setPhotos((p) => [
                ...p,
                {
                  id: crypto.randomUUID(),
                  url: "",
                  caption: "",
                  kind: "shared",
                },
              ])
            }
          >
            <ImagePlus size={16} />
            Add photo link
          </button>
        </div>
        <p className="small muted">
          Open your photo library, copy a shared photo or collection link, and
          paste it below. Load its preview or choose a display photo, then
          select a visit cover. Album links open the full collection at the
          provider.
        </p>
        <PhotoLibraries />
        <AlbumImport
          photos={photos}
          onBusy={photoBusy}
          onAdd={(added) =>
            setPhotos((current) => {
              const seen = new Set(
                current.filter((p) => p.url).map((p) => photoIdentity(p.url)),
              );
              return [
                ...current,
                ...added.filter((p) => {
                  const key = photoIdentity(p.url);
                  if (seen.has(key)) return false;
                  seen.add(key);
                  return true;
                }),
              ].slice(0, MAX_VISIT_PHOTOS);
            })
          }
        />
        <PhotoDropZone
          remaining={MAX_VISIT_PHOTOS - photos.length}
          onBusy={photoBusy}
          onAdd={(added) =>
            setPhotos((current) =>
              [...current, ...added].slice(0, MAX_VISIT_PHOTOS),
            )
          }
        />
        {photos.map((photo, index) => (
          <VisitPhotoEditor
            key={photo.id}
            photo={photo}
            index={index}
            isCover={coverId === photo.id}
            onBusy={photoBusy}
            onChange={(updated) => {
              setPhotos((current) =>
                current.map((item) => (item.id === photo.id ? updated : item)),
              );
              if (coverId === photo.id && !photoSource(updated))
                setCoverId(null);
            }}
            onCover={() => setCoverId(photo.id)}
            onRemove={() => {
              setPhotos((current) =>
                current.filter((item) => item.id !== photo.id),
              );
              if (coverId === photo.id) setCoverId(null);
            }}
          />
        ))}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button className="button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy || photoJobs.size > 0}
          >
            {busy ? (
              <LoaderCircle size={18} className="spin" />
            ) : (
              <Check size={18} />
            )}
            Save visit
          </button>
        </div>
      </form>
    </Modal>
  );
}

function VisitDetail({
  visit,
  place,
  owner,
  onBack,
  onMap,
  onEdit,
  onAddPhotos,
  onDelete,
}: {
  visit: Visit;
  place: Place;
  owner: boolean;
  onBack: () => void;
  onMap: () => void;
  onEdit: () => void;
  onAddPhotos: () => void;
  onDelete: () => Promise<void>;
}) {
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null),
    [confirm, setConfirm] = useState(false),
    [deleteError, setDeleteError] = useState("");
  return (
    <article className="visit-detail content-scroll">
      <div className="detail-nav">
        <button className="text-button" onClick={onBack}>
          <ArrowLeft size={17} />
          Back
        </button>
        {owner && (
          <div className="button-row">
            <button className="button quiet" onClick={onEdit}>
              <Pencil size={15} />
              Edit visit
            </button>
            <button
              className="icon-button danger"
              aria-label="Delete visit"
              onClick={() => setConfirm(true)}
            >
              <Trash2 size={16} />
            </button>
          </div>
        )}
      </div>
      <VisitCarousel
        key={`${visit.id}:${visit.coverId}`}
        photos={visit.photos}
        coverId={visit.coverId}
        suspended={!!selectedPhoto}
        onOpen={setSelectedPhoto}
      />
      <div className="detail-copy">
        <p className="eyebrow">
          {date(visit.date)}
          {!visit.published ? " · Private draft" : ""}
        </p>
        <h2>{visit.title || place?.name}</h2>
        <p className="location-line">
          <MapPin size={16} />
          {place?.name}
          <Stars value={visit.rating} />
        </p>
        {!!visit.attendees?.length && (
          <section
            className="visit-attendees"
            aria-label="People who came along"
          >
            <h3>
              <Users size={17} />
              Who came along
            </h3>
            <ul>
              {visit.attendees.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </section>
        )}
        {visit.summary && <p className="visit-lead">{visit.summary}</p>}
        <div className="prose">
          {visit.notes.split("\n").map((line, i) => (
            <p key={i}>{line || "\u00a0"}</p>
          ))}
        </div>
        <div className="button-row">
          <button className="button" onClick={onMap}>
            <Map size={16} />
            Show place on map
          </button>
          <a
            className="button"
            href={wazeLink(place)}
            target="_blank"
            rel="noreferrer"
          >
            Open Waze <ArrowUpRight size={16} />
          </a>
        </div>
        <section className="photo-gallery">
          <div className="visit-photo-heading">
            <h3>Photos from this visit</h3>
            <button className="button primary" onClick={onAddPhotos}>
              <ImagePlus size={16} />
              Add photos
            </button>
          </div>
          {visit.photos.length === 0 && (
            <p className="small muted">
              No photos added yet. Add shared links or images, then choose a
              visit cover.
            </p>
          )}
          <div className="visit-photo-grid">
            {visit.photos.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedPhoto(p)}
                aria-label={`View photo and comments: ${p.caption || "Visit photo"}`}
              >
                <PhotoImage photo={p} />
                <span>
                  {p.caption ||
                    providerFor(p.url)?.name ||
                    (p.kind === "album" ? "Photo album" : "Visit photo")}
                </span>
              </button>
            ))}
          </div>
        </section>
        {visit.published ? (
          <Comments visit={visit} photoId={null} owner={owner} />
        ) : (
          <p className="notice">Publish this visit to invite comments.</p>
        )}
      </div>
      {selectedPhoto && (
        <Modal
          title={selectedPhoto.caption || "A moment from our visit"}
          onClose={() => setSelectedPhoto(null)}
          wide
        >
          <div className="lightbox-image">
            <PhotoImage photo={selectedPhoto} />
          </div>
          {selectedPhoto.url && (
            <a
              className="text-button"
              href={selectedPhoto.url}
              target="_blank"
              rel="noreferrer"
            >
              {selectedPhoto.kind === "image"
                ? "Open original photo"
                : `Open in ${providerFor(selectedPhoto.url)?.name || "photo provider"}`}{" "}
              <ArrowUpRight size={15} />
            </a>
          )}
          {visit.published && (
            <Comments visit={visit} photoId={selectedPhoto.id} owner={owner} />
          )}
        </Modal>
      )}
      {confirm && (
        <Modal title="Remove this visit?" onClose={() => setConfirm(false)}>
          <div className="form-stack">
            <p>
              This removes the local visit and its local comments. Publish again
              to remove it from the public journal.
            </p>
            {deleteError && <p className="form-error">{deleteError}</p>}
            <div className="button-row">
              <button className="button" onClick={() => setConfirm(false)}>
                Keep visit
              </button>
              <button
                className="button danger-fill"
                onClick={() =>
                  onDelete().catch((e) => setDeleteError(e.message))
                }
              >
                Remove visit
              </button>
            </div>
          </div>
        </Modal>
      )}
    </article>
  );
}

function Comments({
  visit,
  photoId,
  owner,
}: {
  visit: Visit;
  photoId: string | null;
  owner: boolean;
}) {
  const [items, setItems] = useState<Comment[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const key = useRef(crypto.randomUUID());
  const refresh = useCallback(async () => {
    try {
      const r = await api.comments(visit.id);
      setItems(r.comments.filter((c) => (c.photoId || null) === photoId));
      if (r.cloudError) setError(r.cloudError);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [visit.id, photoId]);
  useEffect(() => {
    setError("");
    refresh();
  }, [refresh]);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget,
      d = new FormData(form);
    setBusy(true);
    setError("");
    try {
      const name = String(d.get("name")).trim(),
        body = String(d.get("body")).trim();
      if (!name || !body)
        throw new Error("Please enter your name and a comment.");
      await api.postComment(
        {
          visitId: visit.id,
          photoId,
          name,
          body,
          website: String(d.get("website") || ""),
        },
        key.current,
      );
      key.current = crypto.randomUUID();
      form.reset();
      setNotice(
        "Your comment has been posted. Thank you for sharing the moment.",
      );
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="comments">
      <div className="section-heading">
        <h3>
          <MessageCircle size={20} />
          {photoId ? "About this photo" : "Leave a little note"}
        </h3>
        <span className="count-label">{items.length}</span>
      </div>
      {items.map((c) => (
        <article className="comment" key={c.id}>
          <div className="avatar">
            {c.name.trim().charAt(0).toUpperCase() || "?"}
          </div>
          <div>
            <strong>{c.name}</strong>
            {c.createdAt && (
              <time>{new Date(c.createdAt).toLocaleDateString("en-GB")}</time>
            )}
            <p>{c.body}</p>
          </div>
          {owner && (
            <button
              className="icon-button danger"
              aria-label={`Remove comment by ${c.name}`}
              onClick={async () => {
                try {
                  await api.request(
                    "/api/comments/" +
                      c.id +
                      ((c as Comment & { cloud?: boolean }).cloud
                        ? "?cloud=1"
                        : ""),
                    { method: "DELETE" },
                  );
                  await refresh();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <Trash2 size={15} />
            </button>
          )}
        </article>
      ))}
      <form className="form-stack" onSubmit={submit}>
        <p className="small muted">
          No account needed. Your name and comment will be visible to other
          visitors.
        </p>
        <label>
          Your name
          <input name="name" required maxLength={80} autoComplete="name" />
        </label>
        <label>
          Your comment
          <textarea
            name="body"
            required
            maxLength={2000}
            rows={3}
            placeholder="Share a thought or a favourite memory…"
          />
        </label>
        <label className="honeypot" aria-hidden="true">
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
        {error && (
          <p role="alert" className="form-error">
            {error}{" "}
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setError("");
                refresh();
              }}
            >
              Retry loading
            </button>
          </p>
        )}
        {notice && (
          <p role="status" className="success-note">
            {notice}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          {busy ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <MessageCircle size={17} />
          )}
          Post comment
        </button>
      </form>
    </section>
  );
}

function RouteEditor({
  place,
  onClose,
  onSave,
}: {
  place: Place;
  onClose: () => void;
  onSave: (metres: number, seconds: number) => Promise<void>;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal title={`Driving to ${place.name}`} onClose={onClose}>
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          setBusy(true);
          try {
            await onSave(
              Number(d.get("miles")) * 1609.344,
              Number(d.get("minutes")) * 60,
            );
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          Check the journey from your saved home in Waze, then record its road
          distance and estimated travel time here.
        </p>
        <a
          className="text-button"
          href={wazeLink(place)}
          target="_blank"
          rel="noreferrer"
        >
          Open destination in Waze <ArrowUpRight size={16} />
        </a>
        <div className="form-grid">
          <label>
            Driving distance (miles)
            <input name="miles" type="number" min="0" step="0.1" required />
          </label>
          <label>
            Travel time (minutes)
            <input name="minutes" type="number" min="0" step="1" required />
          </label>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          Save route
        </button>
      </form>
    </Modal>
  );
}

function Workspace({
  home,
  routes,
  places,
  onRefresh,
  notify,
}: {
  home: Home | null;
  routes: Route[];
  places: Place[];
  onRefresh: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const [location, setLocation] = useState(
      home
        ? { label: home.label, lat: home.lat, lng: home.lng }
        : { label: "", lat: 52, lng: 0 },
    ),
    [postcode, setPostcode] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [calculating, setCalculating] = useState(false),
    [site, setSite] = useState<{
      siteUrl: string | null;
      publishedAt: string | null;
    }>({ siteUrl: null, publishedAt: null });
  useEffect(() => {
    api
      .request<typeof site>("/api/site")
      .then(setSite)
      .catch(() => {});
  }, []);
  async function publish() {
    setBusy(true);
    setError("");
    try {
      const s = await api.request<{
        siteUrl: string;
        publishedAt: string;
        pendingLocalChanges?: boolean;
      }>("/api/publish", { method: "POST" });
      setSite(s);
      if (s.pendingLocalChanges)
        setError(
          "The site was published, but newer edits were saved during finalisation. They are safe on this computer; publish again to include them.",
        );
      else notify("Your public journal has been published.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
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
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <section className="settings-section">
        <div>
          <h3>Your starting point</h3>
          <p>
            Kept on this computer. Your exact home and exact distance circle are
            excluded from the public site. The public map uses a centre rounded
            to 0.1° and a range recalculated from that approximate area.
          </p>
        </div>
        <form
          className="form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api.request("/api/home", {
                method: "PUT",
                body: JSON.stringify(location),
              });
              await onRefresh();
              notify(
                home?.lat === location.lat && home?.lng === location.lng
                  ? "Home saved. Your driving distances are unchanged."
                  : "Home updated. Calculate all driving distances for your new starting point below.",
              );
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <div className="postcode-row">
            <label>
              Find a UK postcode
              <input
                value={postcode}
                onChange={(e) => setPostcode(e.target.value)}
                placeholder="Your postcode"
              />
            </label>
            <button
              type="button"
              className="button"
              onClick={async () => {
                try {
                  const h = await api.request<typeof location>(
                    "/api/postcode?q=" + encodeURIComponent(postcode),
                  );
                  setLocation(h);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Find
            </button>
          </div>
          <label>
            Home label
            <input
              value={location.label}
              onChange={(e) =>
                setLocation({ ...location, label: e.target.value })
              }
              required
            />
          </label>
          <div className="form-grid">
            <label>
              Latitude
              <input
                type="number"
                step="any"
                value={location.lat}
                onChange={(e) =>
                  setLocation({ ...location, lat: Number(e.target.value) })
                }
                required
              />
            </label>
            <label>
              Longitude
              <input
                type="number"
                step="any"
                value={location.lng}
                onChange={(e) =>
                  setLocation({ ...location, lng: Number(e.target.value) })
                }
                required
              />
            </label>
          </div>
          <button className="button primary" disabled={busy || calculating}>
            Save home
          </button>
        </form>
      </section>
      <section className="settings-section">
        <div>
          <h3>Driving distances</h3>
          <p>
            Calculate the driving distance and time to every place in one go.
            They’re saved on this computer and reused for your next five places.
            You only need to calculate them again if you move your starting
            point.
          </p>
          <p className="small muted">
            {routes.length} of {places.length} places have a saved driving
            distance
            {home ? " from this home." : ". Set your starting point first."}
          </p>
        </div>
        <div className="form-stack">
          <button
            className="button primary"
            disabled={
              busy || calculating || !home || routes.length >= places.length
            }
            onClick={async () => {
              setCalculating(true);
              setError("");
              try {
                const result = await api.request<{
                  saved: number;
                  total: number;
                  remaining: number;
                }>("/api/routes/refresh", { method: "POST" });
                await onRefresh();
                notify(
                  result.remaining
                    ? `${result.saved} of ${result.total} distances saved. ${result.remaining} places need a road-access check; see the README for agent instructions.`
                    : `All ${result.total} driving distances are saved.`,
                );
              } catch (e) {
                setError((e as Error).message);
                await onRefresh();
              } finally {
                setCalculating(false);
              }
            }}
          >
            {calculating ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <RouteIcon size={17} />
            )}
            {calculating
              ? "Calculating all distances…"
              : routes.length >= places.length
                ? "All distances saved"
                : "Calculate all distances"}
          </button>
          <p className="small muted" role="status">
            {calculating
              ? "This may take a minute or two. Each batch is saved as it finishes."
              : "Saved distances don’t expire. If a calculation is interrupted, run it again to finish the remaining places."}
          </p>
          <p className="small muted">
            Free estimates from OSRM / FOSSGIS. Calculating sends your starting
            point to the routing service. Waze still opens directions for each
            trip.
          </p>
        </div>
      </section>
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
            disabled={busy || calculating}
          >
            {busy ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <Globe size={18} />
            )}{" "}
            {busy ? "Building and publishing…" : "Publish journal to here.now"}
          </button>
          <p className="small muted">
            Reuses this project’s dedicated site. Private drafts, home settings
            and account credentials stay local.
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

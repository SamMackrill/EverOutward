import { useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  Compass,
  Globe,
  Home as HomeIcon,
  Info,
  Route as RouteIcon,
  Search,
  X,
} from "lucide-react";
import MapView from "./MapView";
import type {
  Home,
  HomeJourney,
  Place,
  Route,
  Visit,
  VisitRange,
} from "./types";

export type MapCommand = {
  kind: "uk" | "home" | "place" | "next" | "homes";
  id?: string;
  serial: number;
};

export default function MapPanel({
  hidden,
  places,
  visits,
  routes,
  visited,
  nextId,
  nextIds,
  home,
  homeJourneys,
  activeHomeId,
  range,
  theme,
  selectedId,
  command,
  onCommand,
  onSelect,
  onFind,
  onChooseHome,
  onBrowseList,
}: {
  hidden: boolean;
  places: Place[];
  visits: Visit[];
  routes: Route[];
  visited: Set<string>;
  nextId?: string;
  nextIds: string[];
  home: Home | null;
  homeJourneys: HomeJourney[];
  activeHomeId: string | null;
  range: VisitRange | null;
  theme: string;
  selectedId?: string;
  command: MapCommand;
  onCommand: (kind: MapCommand["kind"]) => void;
  onSelect: (place: Place) => void;
  onFind: (place: Place) => void;
  onChooseHome: (id: string) => void;
  onBrowseList: () => void;
}) {
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [searching, setSearching] = useState(false),
    [legendOpen, setLegendOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
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
  const closeSearch = () => {
    setSearching(false);
    setQuery("");
    setFilter("all");
    toggle.current?.focus();
  };
  const views = [
    nextIds.length > 0 && {
      kind: "next" as const,
      label: "Next five",
      Icon: RouteIcon,
    },
    home && { kind: "home" as const, label: "Around home", Icon: HomeIcon },
    homeJourneys.length > 1 && {
      kind: "homes" as const,
      label: "All homes",
      Icon: HomeIcon,
    },
    { kind: "uk" as const, label: "Whole UK", Icon: Globe },
  ].filter((v) => !!v);
  return (
    <div className="map-view" hidden={hidden}>
      <div className="map-toolbar compact-toolbar">
        {searching ? (
          <div className="secondary-search">
            <label className="search">
              <Search size={18} />
              <input
                aria-label="Search National Trust places"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") closeSearch();
                }}
                placeholder="Place name"
                autoFocus
              />
              {query && (
                <button aria-label="Clear search" onClick={() => setQuery("")}>
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
        ) : homeJourneys.length > 0 ? (
          <label className="home-switcher">
            <HomeIcon size={16} aria-hidden="true" />
            <span>Distances from</span>
            <select
              aria-label="Current home location"
              value={activeHomeId || ""}
              onChange={(e) => onChooseHome(e.target.value)}
            >
              {homeJourneys.map((h) => (
                <option value={h.id} key={h.id}>
                  {h.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="map-rule">
            <Compass size={16} />
            England, Wales &amp; Northern Ireland
          </span>
        )}
        <button
          ref={toggle}
          className="text-button map-search-toggle"
          aria-expanded={searching}
          onClick={() => (searching ? closeSearch() : setSearching(true))}
        >
          {searching ? (
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
          nextId={nextId}
          nextIds={nextIds}
          home={home}
          homeJourneys={homeJourneys}
          activeHomeId={activeHomeId}
          range={range}
          theme={theme}
          selectedId={selectedId}
          onSelect={onSelect}
          command={command}
        />
        <div className="map-view-controls" role="group" aria-label="Map view">
          {views.map(({ kind, label, Icon }) => (
            <button
              key={kind}
              aria-pressed={command.kind === kind}
              onClick={() => {
                if (kind === "next") {
                  setQuery("");
                  setFilter("all");
                }
                onCommand(kind);
              }}
            >
              <Icon size={15} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
        <button
          className="legend-toggle"
          aria-label="Map key"
          aria-expanded={legendOpen}
          aria-controls="map-legend"
          onClick={() => setLegendOpen((open) => !open)}
        >
          {legendOpen ? <X size={17} /> : <Info size={17} />}
        </button>
        <div
          id="map-legend"
          className={`map-legend ${legendOpen ? "open" : ""}`}
        >
          <span>
            <i className="dot unvisited" />
            Still to explore
          </span>
          <span>
            <i className="dot done" />
            Visited
          </span>
          {nextIds.length > 0 && (
            <span>
              <i className="legend-pin" />
              Next five
            </span>
          )}
          <span>
            <i className="legend-cluster">3</i>
            Group of places
          </span>
          {range && range.radius > 0 && (
            <span>
              <i className="range-swatch" />
              {range.approximate
                ? "Current circle · approximate"
                : "Current discovery circle"}
            </span>
          )}
          {homeJourneys.length > 1 && (
            <span>
              <i className="range-swatch other-home-swatch" />
              Other homes
            </span>
          )}
        </div>
        {query && (
          <div className="search-results">
            <small>{filtered.length} places found</small>
            {filtered.slice(0, 12).map((p) => (
              <button key={p.id} onClick={() => onFind(p)}>
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
        <button className="text-button" onClick={onBrowseList}>
          Browse accessible place list <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

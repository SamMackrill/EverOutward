import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import type {
  Home,
  HomeJourney,
  Place,
  Visit,
  Route,
  VisitRange,
} from "./types";
import type { GeoJsonObject } from "geojson";

type Basemap = {
  countries: GeoJsonObject;
  cities: { name: string; lat: number; lng: number; zoom: number }[];
};

type Props = {
  places: Place[];
  visits: Visit[];
  routes: Route[];
  visited: Set<string>;
  nextId?: string;
  nextIds?: string[];
  home: Home | null;
  homeJourneys: HomeJourney[];
  activeHomeId: string | null;
  range: VisitRange | null;
  theme: string;
  selectedId?: string;
  onSelect: (p: Place) => void;
  command: {
    kind: "uk" | "home" | "place" | "next" | "homes";
    id?: string;
    serial: number;
  };
};
export default function MapView({
  places,
  visits,
  routes,
  visited,
  nextId,
  nextIds = [],
  home,
  homeJourneys,
  activeHomeId,
  range,
  theme,
  selectedId,
  onSelect,
  command,
}: Props) {
  const nextIdsKey = nextIds.join("|");
  const [tileFailed, setTileFailed] = useState(false);
  const [basemap, setBasemap] = useState<Basemap | null>(null),
    [baseFailed, setBaseFailed] = useState(false),
    [mapStyle, setMapStyle] = useState("streets");
  const div = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    layers = useRef<L.LayerGroup | null>(null),
    baseLayers = useRef<L.LayerGroup | null>(null),
    tiles = useRef<L.TileLayer | null>(null),
    select = useRef(onSelect);
  select.current = onSelect;
  useEffect(() => {
    if (!div.current) return;
    const m = L.map(div.current, {
      zoomControl: false,
      scrollWheelZoom: true,
      minZoom: 4,
      maxZoom: 19,
      zoomSnap: 0.25,
    }).setView([54.3, -3.3], 6);
    L.control.zoom({ position: "bottomleft" }).addTo(m);
    L.control
      .scale({ imperial: true, metric: false, position: "bottomright" })
      .addTo(m);
    map.current = m;
    m.createPane("baseLand").style.zIndex = "190";
    m.createPane("baseLabels").style.zIndex = "210";
    m.getPane("baseLabels")!.style.pointerEvents = "none";
    baseLayers.current = L.layerGroup().addTo(m);
    m.attributionControl.addAttribution(
      'Made with <a href="https://www.naturalearthdata.com/">Natural Earth</a>',
    );
    layers.current = L.layerGroup().addTo(m);
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(div.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    let alive = true;
    fetch("/data/basemap.json")
      .then((r) => {
        if (!r.ok) throw new Error("Basemap unavailable");
        return r.json();
      })
      .then((data) => {
        if (alive) setBasemap(data);
      })
      .catch(() => {
        if (alive) setBaseFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    const m = map.current,
      l = baseLayers.current;
    if (!m || !l || !basemap) return;
    l.clearLayers();
    const dark = theme === "dark";
    L.geoJSON(basemap.countries, {
      pane: "baseLand",
      interactive: false,
      style: (feature) => ({
        fillColor: dark
          ? feature?.properties.code === "GBR"
            ? "#314938"
            : "#293e33"
          : feature?.properties.code === "GBR"
            ? "#f4f2df"
            : "#e4e8df",
        color: dark ? "#708779" : "#bac9bb",
        weight: 1,
        fillOpacity: 1,
      }),
    }).addTo(l);
    const labels = L.layerGroup().addTo(l);
    const drawLabels = () => {
      labels.clearLayers();
      if (mapStyle === "streets" && !tileFailed) return;
      for (const city of basemap.cities.filter((c) => c.zoom <= m.getZoom())) {
        const label = document.createElement("span");
        label.textContent = city.name;
        L.marker([city.lat, city.lng], {
          pane: "baseLabels",
          interactive: false,
          keyboard: false,
          icon: L.divIcon({
            className: "settlement-label",
            html: label,
            iconSize: [100, 20],
            iconAnchor: [50, 0],
          }),
        }).addTo(labels);
      }
      if (m.getZoom() < 7)
        for (const [name, lat, lng] of [
          ["Scotland", 57, -4.3],
          ["England", 52.8, -1.7],
          ["Wales", 52.2, -3.9],
          ["Northern Ireland", 54.85, -6.8],
          ["Ireland", 53.5, -8.0],
        ] as [string, number, number][]) {
          const label = document.createElement("span");
          label.textContent = name;
          L.marker([lat, lng], {
            pane: "baseLabels",
            interactive: false,
            keyboard: false,
            icon: L.divIcon({
              className: "country-label",
              html: label,
              iconSize: [140, 25],
              iconAnchor: [70, 12],
            }),
          }).addTo(labels);
        }
    };
    drawLabels();
    m.on("zoomend", drawLabels);
    return () => {
      m.off("zoomend", drawLabels);
      l.clearLayers();
    };
  }, [basemap, theme, mapStyle, tileFailed]);
  useEffect(() => {
    if (!map.current) return;
    tiles.current?.remove();
    setTileFailed(false);
    if (mapStyle !== "streets") return;
    const layer = L.tileLayer(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
        maxZoom: 19,
        referrerPolicy: "strict-origin-when-cross-origin",
        className: theme === "dark" ? "dark-map-tiles" : "",
      },
    );
    layer.on("tileerror", () => {
      layer.remove();
      setTileFailed(true);
    });
    tiles.current = layer.addTo(map.current);
    return () => {
      layer.remove();
    };
  }, [theme, mapStyle]);
  useEffect(() => {
    const l = layers.current;
    if (!l) return;
    l.clearLayers();
    const homeMarkers: L.Marker[] = [];
    const mapHomes = homeJourneys.length
      ? homeJourneys
      : range
        ? [
            {
              id: "legacy",
              label: "Starting area",
              colour: "#007a3b",
              range,
              complete: true,
            },
          ]
        : [];
    [...mapHomes]
      .sort(
        (a, b) => Number(a.id === activeHomeId) - Number(b.id === activeHomeId),
      )
      .forEach((h, index) => {
        const active = h.id === activeHomeId || h.id === "legacy";
        const colour =
          theme === "dark"
            ? "#" +
              h.colour
                .slice(1)
                .match(/.{2}/g)!
                .map((v) =>
                  Math.round(parseInt(v, 16) * 0.55 + 255 * 0.45)
                    .toString(16)
                    .padStart(2, "0"),
                )
                .join("")
            : h.colour;
        if (h.range.radius > 0)
          L.circle([h.range.centre.lat, h.range.centre.lng], {
            radius: h.range.radius,
            color: colour,
            weight: active ? 4 : 1.5,
            dashArray: active ? undefined : "5 5",
            fillColor: colour,
            fillOpacity: active ? 0.18 : 0.045,
            interactive: false,
            className: active
              ? "visit-range-circle current-home-circle"
              : "visit-range-circle other-home-circle",
          }).addTo(l);
        const icon = document.createElement("span");
        icon.className = active ? "home-centre current" : "home-centre";
        icon.style.backgroundColor = colour;
        icon.textContent = "⌂";
        const label = document.createElement("span");
        label.textContent =
          h.label +
          (active ? " · Current" : "") +
          (h.range.approximate ? " · approximate" : "") +
          (!(h.range.confirmed ?? h.complete)
            ? " · circle pending: distances need review"
            : h.range.radius === 0
              ? " · no visits inside next gate yet"
              : "");
        const homeMarker = L.marker([h.range.centre.lat, h.range.centre.lng], {
          icon: L.divIcon({
            className: "multi-home-marker",
            html: icon,
            iconSize: [active ? 30 : 24, active ? 30 : 24],
          }),
          title: label.textContent,
          zIndexOffset: active ? 2000 : 1500,
        })
          .addTo(l)
          .bindTooltip(label, {
            permanent: true,
            direction: active ? "top" : index % 2 ? "right" : "left",
            offset: active ? [0, -16] : [index % 2 ? 14 : -14, 0],
            className: active ? "home-map-label current" : "home-map-label",
          });
        homeMarkers.push(homeMarker);
      });
    const cluster = L.markerClusterGroup({
      maxClusterRadius: 35,
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      iconCreateFunction: (g) =>
        L.divIcon({
          className: "place-cluster",
          html: `<span>${g.getChildCount()}</span>`,
          iconSize: [35, 35],
        }),
    }).addTo(l);
    for (const p of places) {
      const done = visited.has(p.id),
        next = nextIds.includes(p.id) || p.id === nextId,
        selected = p.id === selectedId;
      const history = visits
          .filter((v) => v.placeId === p.id)
          .sort((a, b) => b.date.localeCompare(a.date)),
        r = routes.find((r) => r.placeId === p.id);
      const node = document.createElement("div");
      node.className = "map-tooltip";
      const heading = document.createElement("strong");
      heading.textContent = p.name;
      const route = document.createElement("small");
      route.textContent = r
        ? `${(r.metres / 1609.344).toFixed(1)} mi by road`
        : "Road distance unavailable";
      node.append(heading, route);
      if (p.boatRequired) {
        const boat = document.createElement("small");
        boat.className = "boat-notice";
        boat.textContent = "⛴ Boat trip required";
        node.append(boat);
      }
      if (history.length) {
        const list = document.createElement("ul");
        list.className = "map-visit-list";
        list.setAttribute("aria-label", "Previous visits");
        list.tabIndex = 0;
        for (const visit of history) {
          const row = document.createElement("li");
          const date = document.createElement("time");
          date.dateTime = visit.date;
          date.textContent = new Date(
            `${visit.date}T12:00:00`,
          ).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          });
          row.append(date);
          if (visit.attendees?.length) {
            const people = document.createElement("span");
            people.textContent = visit.attendees.join(", ");
            row.append(people);
          }
          list.append(row);
        }
        node.append(list);
        L.DomEvent.disableScrollPropagation(list);
      }
      const marker = L.marker([p.lat, p.lng], {
        icon: L.divIcon({
          className: `place-marker ${done ? "visited" : ""} ${next ? "next" : ""} ${selected ? "selected" : ""}`,
          html: done
            ? "✓"
            : next
              ? String(Math.max(1, nextIds.indexOf(p.id) + 1))
              : "",
          iconSize: next || selected ? [24, 24] : [14, 14],
        }),
        title: p.name,
        keyboard: true,
        zIndexOffset: selected ? 1000 : next ? 500 : done ? 100 : 0,
      });
      marker.addTo(next || selected ? l : cluster).bindTooltip(node, {
        className: "place-tooltip",
        direction: "top",
        offset: [0, -8],
        interactive: true,
      });
      marker.on("click", () => select.current(p));
      marker.on("add", () => {
        const el = marker.getElement();
        el?.addEventListener("focus", () => marker.openTooltip());
        el?.addEventListener("blur", () => marker.closeTooltip());
      });
    }
    // Reserve space for the current label first, then place nearby labels around it.
    const arrangeLabels = () => {
      const occupied: DOMRect[] = [];
      for (const marker of [...homeMarkers].reverse()) {
        const tooltip = marker.getTooltip();
        if (!tooltip?.getElement()) continue;
        const positions: [L.Direction, L.PointExpression][] = [
          ["top", [0, -16]],
          ["right", [18, 0]],
          ["left", [-18, 0]],
          ["bottom", [0, 18]],
          ["right", [18, -48]],
          ["left", [-18, 48]],
          ["right", [18, 48]],
          ["left", [-18, -48]],
        ];
        for (const [direction, offset] of positions) {
          tooltip.options.direction = direction;
          tooltip.options.offset = L.point(offset);
          tooltip.update();
          const rect = tooltip.getElement()!.getBoundingClientRect();
          if (
            !occupied.some(
              (r) =>
                rect.left < r.right + 6 &&
                rect.right > r.left - 6 &&
                rect.top < r.bottom + 6 &&
                rect.bottom > r.top - 6,
            )
          )
            break;
        }
        occupied.push(tooltip.getElement()!.getBoundingClientRect());
      }
    };
    const frame = requestAnimationFrame(arrangeLabels);
    map.current?.on("zoomend moveend", arrangeLabels);
    return () => {
      cancelAnimationFrame(frame);
      map.current?.off("zoomend moveend", arrangeLabels);
      l.clearLayers();
    };
  }, [
    places,
    visits,
    routes,
    visited,
    nextId,
    nextIdsKey,
    home,
    homeJourneys,
    activeHomeId,
    range?.radius,
    range?.centre.lat,
    range?.centre.lng,
    theme,
    selectedId,
  ]);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    // Home and queue updates can arrive in adjacent renders. Finish the new
    // framing immediately so a previous pan cannot move the map back afterward.
    m.stop();
    if (command.kind === "homes" && homeJourneys.length) {
      const bounds = L.latLngBounds(
        homeJourneys.map(
          (h) => [h.range.centre.lat, h.range.centre.lng] as [number, number],
        ),
      );
      homeJourneys.forEach((h) => {
        if (h.range.radius)
          bounds.extend(
            L.latLng(h.range.centre.lat, h.range.centre.lng).toBounds(
              h.range.radius * 2,
            ),
          );
      });
      m.fitBounds(bounds, { padding: [55, 55], maxZoom: 11, animate: false });
    } else if (command.kind === "next") {
      const upcoming = places.filter((p) => nextIds.includes(p.id));
      if (upcoming.length) {
        const bounds = L.latLngBounds(
          [...upcoming, ...(range ? [range.centre] : home ? [home] : [])].map(
            (p) => [p.lat, p.lng] as [number, number],
          ),
        );
        if (range && range.radius > 0)
          bounds.extend(
            L.latLng(range.centre.lat, range.centre.lng).toBounds(
              range.radius * 2,
            ),
          );
        m.fitBounds(bounds, { padding: [45, 45], maxZoom: 11, animate: false });
      } else if (range)
        m.setView([range.centre.lat, range.centre.lng], 10, { animate: false });
    } else if (command.kind === "uk")
      m.fitBounds(
        [
          [49.8, -8.5],
          [61, 2],
        ],
        { padding: [30, 30], animate: false },
      );
    else if (command.kind === "home" && home)
      m.setView([home.lat, home.lng], 10, { animate: false });
    else if (command.kind === "place") {
      const p = places.find((p) => p.id === command.id);
      if (p) m.setView([p.lat, p.lng], 11, { animate: false });
    }
  }, [
    command,
    homeJourneys,
    activeHomeId,
    home,
    places,
    nextIdsKey,
    range?.centre.lat,
    range?.centre.lng,
    range?.radius,
  ]);
  return (
    <>
      <div
        ref={div}
        className="map-canvas"
        aria-label="Interactive map of National Trust destinations. Use the places list for an accessible alternative."
      />
      <label className="map-style">
        <span className="visually-hidden">Map detail</span>
        <select
          aria-label="Map detail"
          value={mapStyle}
          onChange={(e) => setMapStyle(e.target.value)}
        >
          <option value="overview">Overview map</option>
          <option value="streets">Street detail</option>
        </select>
      </label>
      {baseFailed && (
        <div className="map-error" role="status">
          The overview map could not be loaded. Refresh to retry, or use the
          places list.
        </div>
      )}
      {tileFailed && (
        <div className="map-error" role="status">
          Street detail is unavailable. The overview map is still available.
        </div>
      )}
    </>
  );
}

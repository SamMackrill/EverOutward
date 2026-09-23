import { useEffect, useRef, useState } from "react";
import {
  Check,
  Home as HomeIcon,
  LoaderCircle,
  Plus,
  Route as RouteIcon,
} from "lucide-react";
import L from "leaflet";
import Modal from "./Modal";
import { HowItWorks } from "./shared";
import type { Home, HomeJourney } from "./types";
import * as api from "./api";

export function LocationPin({
  lat,
  lng,
  onChange,
  entrance = false,
}: {
  lat: number;
  lng: number;
  onChange: (lat: number, lng: number) => void;
  entrance?: boolean;
}) {
  const div = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    pin = useRef<L.Marker | null>(null),
    change = useRef(onChange);
  change.current = onChange;
  useEffect(() => {
    if (!div.current) return;
    const m = L.map(div.current).setView([lat, lng], 12);
    map.current = m;
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      referrerPolicy: "strict-origin-when-cross-origin",
      maxZoom: 19,
    }).addTo(m);
    pin.current = L.marker([lat, lng], {
      draggable: true,
      icon: L.divIcon({
        className: "home-picker-pin",
        html: entrance ? "<span>●</span>" : "<span>⌂</span>",
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      }),
    }).addTo(m);
    const update = (point: L.LatLng) =>
      change.current(+point.lat.toFixed(6), +point.lng.toFixed(6));
    m.on("click", (e: L.LeafletMouseEvent) => update(e.latlng));
    pin.current.on("dragend", () => update(pin.current!.getLatLng()));
    const observer = new ResizeObserver(() => m.invalidateSize());
    observer.observe(div.current);
    return () => {
      observer.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      pin.current?.setLatLng([lat, lng]);
      map.current?.panTo([lat, lng]);
    }
  }, [lat, lng]);
  return (
    <div
      ref={div}
      className="home-location-picker"
      aria-label={`Choose ${entrance ? "visitor entrance" : "home position"}: click the map or drag its pin. Latitude and longitude fields are available below.`}
    />
  );
}

/** Renders the guarded form for creating or editing a home location. */
function HomeEditor({
  home,
  homes,
  onClose,
  onSave,
}: {
  home: Home | null;
  homes: Home[];
  onClose: () => void;
  onSave: () => Promise<void>;
}) {
  const [location, setLocation] = useState({
    label: home?.label || "",
    colour: home?.colour || "#007a3b",
    lat: home?.lat ?? 52,
    lng: home?.lng ?? 0,
  });
  const [postcode, setPostcode] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [initial] = useState(() => JSON.stringify(location));
  return (
    <Modal
      title={home ? "Edit home location" : "Add home location"}
      closeLabel="Close home dialog"
      onClose={onClose}
      isDirty={() =>
        JSON.stringify(location) !== initial || postcode.trim() !== ""
      }
    >
      {(requestClose) => (
        <form
          className="form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await api.request(home ? `/api/homes/${home.id}` : "/api/homes", {
                method: home ? "PATCH" : "POST",
                body: JSON.stringify({
                  ...location,
                  expectedVersion: home?.version,
                }),
              });
              await onSave();
              onClose();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="home-name-colour">
            <label>
              Home name
              <input
                value={location.label}
                onChange={(e) =>
                  setLocation({ ...location, label: e.target.value })
                }
                required
                maxLength={120}
                autoFocus
              />
            </label>
            <label>
              Colour
              <input
                type="color"
                value={location.colour}
                onChange={(e) =>
                  setLocation({ ...location, colour: e.target.value })
                }
              />
            </label>
          </div>
          <p className="small muted">
            Names appear on the map and published visits. Use a friendly name if
            you do not want to share an address or postcode.
          </p>
          {homes.some(
            (h) =>
              h.id !== home?.id &&
              h.label.toLowerCase() === location.label.trim().toLowerCase(),
          ) && (
            <p className="small muted">
              Another home has this name. A distinct name makes the map and trip
              origins easier to recognise.
            </p>
          )}
          <div className="postcode-row">
            <label>
              Find a UK postcode
              <input
                value={postcode}
                onChange={(e) => setPostcode(e.target.value)}
                autoComplete="postal-code"
              />
            </label>
            <button
              type="button"
              className="button"
              disabled={busy || !postcode.trim()}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const result = await api.request<{
                    label: string;
                    lat: number;
                    lng: number;
                  }>(`/api/postcode?q=${encodeURIComponent(postcode)}`);
                  setLocation((old) => ({
                    ...old,
                    lat: result.lat,
                    lng: result.lng,
                    label: old.label || result.label,
                  }));
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Find postcode
            </button>
          </div>
          <LocationPin
            lat={location.lat}
            lng={location.lng}
            onChange={(lat, lng) =>
              setLocation((old) => ({ ...old, lat, lng }))
            }
          />
          <p className="small muted">
            Click the map or drag the pin. Exact coordinates stay private; the
            published map shows an approximate area.
          </p>
          <div className="form-grid">
            <label>
              Latitude
              <input
                type="number"
                min="49"
                max="61"
                step="any"
                required
                value={location.lat}
                onChange={(e) =>
                  setLocation({ ...location, lat: Number(e.target.value) })
                }
              />
            </label>
            <label>
              Longitude
              <input
                type="number"
                min="-9"
                max="3"
                step="any"
                required
                value={location.lng}
                onChange={(e) =>
                  setLocation({ ...location, lng: Number(e.target.value) })
                }
              />
            </label>
          </div>
          {home && (
            <p className="small muted">
              Changing the position requires new distances for this home.
              Renaming or recolouring keeps its saved distances. Previous trips
              keep their recorded starting point.
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="button-row">
            <button className="button primary" disabled={busy}>
              {busy ? "Saving…" : "Save home location"}
            </button>
            <button className="button" type="button" onClick={requestClose}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/** Manages home locations, current-home selection, and route calculations. */
export default function HomeLocations({
  homes,
  currentId,
  journeys,
  onRefresh,
  notify,
  onBusy,
  onReview,
}: {
  homes: Home[];
  currentId: string | null;
  journeys: HomeJourney[];
  onRefresh: () => Promise<void>;
  notify: (message: string) => void;
  onBusy: (busy: boolean) => void;
  onReview?: (homeId: string, placeId: string) => void;
}) {
  const [editor, setEditor] = useState<Home | "new" | null>(null),
    [removing, setRemoving] = useState<Home | null>(null),
    [replacement, setReplacement] = useState("");
  const [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  async function run(id: string, action: () => Promise<void>) {
    setBusy(id);
    onBusy(true);
    setError("");
    try {
      await action();
      await onRefresh();
    } catch (e) {
      setError((e as Error).message);
      await onRefresh().catch(() => {});
    } finally {
      setBusy("");
      onBusy(false);
    }
  }
  return (
    <section className="home-locations-section">
      <div className="section-heading">
        <div>
          <h3>Home locations</h3>
          <p>Choose your current starting point.</p>
          <HowItWorks>
            <p>
              Every home keeps its own distances and discovery circle; visited
              places are shared.
            </p>
            <p>
              Distances do not expire. Calculating sends this home’s coordinates
              to OSRM / FOSSGIS. Each batch is saved; rerun an interrupted
              calculation to finish the remaining places. Publishing reuses
              saved distances.
            </p>
          </HowItWorks>
        </div>
        <button
          className="button primary"
          disabled={!!busy}
          onClick={() => setEditor("new")}
        >
          <Plus size={16} />
          Add home location
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!homes.length && (
        <p className="home-empty">
          Add your first home to calculate driving distances and record where
          each trip starts.
        </p>
      )}
      <div className="home-location-list">
        {homes.map((home) => {
          const journey = journeys.find((h) => h.id === home.id),
            saved = journey?.saved || 0,
            total = journey?.total || 0;
          return (
            <article
              className={`home-location-card ${home.id === currentId ? "is-current" : ""}`}
              key={home.id}
            >
              <div className="home-card-heading">
                <span
                  className="home-colour"
                  style={{ backgroundColor: home.colour }}
                />
                <h4>{home.label}</h4>
                {home.id === currentId && (
                  <span className="current-home-tag">
                    <Check size={14} />
                    Current
                  </span>
                )}
              </div>
              <p className="small muted">
                {saved} of {total} places have a saved driving distance.
                {(journey?.range.confirmed ?? journey?.complete)
                  ? // Under a tenth of a mile would print as "0.0 miles".
                    journey!.range.radius >= 161
                    ? ` Discovery circle: ${(journey!.range.radius / 1609.344).toFixed(1)} miles.`
                    : " No visits within range yet."
                  : " Circle pending: a missing driving distance could change its boundary."}
              </p>
              <div className="button-row">
                {home.id !== currentId && (
                  <button
                    className="button"
                    disabled={!!busy}
                    onClick={() =>
                      run(home.id, async () => {
                        await api.request("/api/homes/current", {
                          method: "PUT",
                          body: JSON.stringify({ homeId: home.id }),
                        });
                        notify(`Starting from ${home.label}.`);
                      })
                    }
                  >
                    <HomeIcon size={15} />
                    Make current
                  </button>
                )}
                <button
                  className="button"
                  disabled={!!busy}
                  onClick={() => setEditor(home)}
                >
                  Edit
                </button>
                <button
                  className="text-button danger remove-home"
                  disabled={!!busy}
                  onClick={() => {
                    setRemoving(home);
                    setReplacement(
                      homes.find((h) => h.id !== home.id)?.id || "",
                    );
                  }}
                >
                  Remove
                </button>
              </div>
              <button
                className="button"
                disabled={!!busy || (total > 0 && saved >= total)}
                onClick={() =>
                  run(home.id, async () => {
                    const result = await api.request<{
                      saved: number;
                      total: number;
                      remaining: number;
                    }>(`/api/homes/${home.id}/routes/refresh`, {
                      method: "POST",
                    });
                    notify(
                      `${result.saved} of ${result.total} distances saved for ${home.label}.${result.remaining ? ` ${result.remaining} places need an entrance check.` : ""}`,
                    );
                  })
                }
              >
                {busy === home.id ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <RouteIcon size={16} />
                )}
                {busy === home.id
                  ? "Working…"
                  : saved >= total && total
                    ? "All distances saved"
                    : `Calculate all distances for ${home.label}`}
              </button>
              {!!journey?.unavailablePlaces?.length && (
                <details>
                  <summary>
                    {journey.unavailablePlaces.length} places need an entrance
                    check
                  </summary>
                  <ul>
                    {journey.unavailablePlaces.map((p) => (
                      <li key={p.placeId}>
                        {p.name}: {p.reason}{" "}
                        {onReview && (
                          <button
                            className="text-button"
                            onClick={() => onReview(home.id, p.placeId)}
                          >
                            Review {p.name}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </article>
          );
        })}
      </div>
      {editor && (
        <HomeEditor
          home={editor === "new" ? null : editor}
          homes={homes}
          onClose={() => setEditor(null)}
          onSave={onRefresh}
        />
      )}
      {removing && (
        <Modal
          title={`Remove ${removing.label}?`}
          closeLabel="Close home dialog"
          onClose={() => setRemoving(null)}
        >
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              run(removing.id, async () => {
                await api.request(`/api/homes/${removing.id}`, {
                  method: "DELETE",
                  body: JSON.stringify({ replacementId: replacement }),
                });
                setRemoving(null);
                notify(
                  "Home removed. Previous trips keep their recorded starting location.",
                );
              });
            }}
          >
            <p>
              Remove this home from the map and available starting points.
              Previous trips and their starting locations are kept.
            </p>
            {homes.length < 2 ? (
              <p>Add another home before removing the last location.</p>
            ) : (
              removing.id === currentId && (
                <label>
                  New current home
                  <select
                    aria-label="New current home"
                    value={replacement}
                    onChange={(e) => setReplacement(e.target.value)}
                    required
                  >
                    {homes
                      .filter((h) => h.id !== removing.id)
                      .map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.label}
                        </option>
                      ))}
                  </select>
                </label>
              )
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="button-row">
              <button
                className="button danger"
                disabled={!!busy || homes.length < 2}
              >
                Remove home location
              </button>
              <button
                className="button"
                type="button"
                onClick={() => setRemoving(null)}
              >
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}

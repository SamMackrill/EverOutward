import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, LoaderCircle, X } from "lucide-react";
import type { Home, Place, Route } from "./types";
import { LocationPin } from "./HomeLocations";
import { wazeLink } from "../server/domain.mjs";
import * as api from "./api";
import BoatNotice from "./BoatNotice";

type ReviewRow = {
  placeId: string;
  name: string;
  route: Route | null;
  revision: string;
  status: "needs-review" | "resolved" | "saved" | "missing";
  reason: string;
  reviewNote: string;
  entranceSourceUrl: string;
  reviewedAt: string | null;
};
const labels = {
  "needs-review": "Needs review",
  resolved: "Resolved",
  saved: "Saved",
  missing: "Missing distance",
};
export type ReviewSelection = {
  homeId: string;
  placeId: string;
  serial: number;
};

function ReviewDialog({
  row,
  place,
  home,
  onClose,
  onSaved,
}: {
  row: ReviewRow;
  place: Place;
  home: Home;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [action, setAction] = useState("manual"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [position, setPosition] = useState({
    lat: place.entrance?.lat || place.lat,
    lng: place.entrance?.lng ?? place.lng,
  });
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      className="modal"
      ref={dialog}
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
    >
      <header>
        <div>
          <p className="eyebrow">Distance review · {home.label}</p>
          <h2>{place.name}</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close distance review"
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </header>
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            const result = await api.request<{
              outcomes: { home: string; resolved: boolean; error?: string }[];
            }>(`/api/distance-review/${place.id}`, {
              method: "POST",
              body: JSON.stringify({
                homeId: home.id,
                homeVersion: home.version,
                revision: row.revision,
                action,
                ...(action === "manual"
                  ? {
                      metres: Number(form.get("miles")) * 1609.344,
                      seconds: Number(form.get("minutes")) * 60,
                      source: String(form.get("source")),
                    }
                  : {}),
                ...(action === "entrance"
                  ? {
                      entrance: position,
                      publicNote: String(form.get("publicNote")),
                      sourceUrl: String(form.get("sourceUrl")),
                    }
                  : {}),
                ...(action === "flag"
                  ? { reason: String(form.get("reason")) }
                  : {}),
                note: String(form.get("note") || ""),
              }),
            });
            const unresolved = result.outcomes.filter((o) => !o.resolved);
            await onSaved(
              unresolved.length
                ? `Saved; ${unresolved.map((o) => o.home + ": " + o.error).join(" ")} Publishing queued.`
                : "Correction saved. Publishing queued; see progress below.",
            );
            onClose();
          } catch (error) {
            setError((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="review-reason">
          {row.reason ||
            "Check the saved route against the actual visitor entrance and road journey."}
        </p>
        <BoatNotice place={place} />
        {row.route && (
          <p className="small">
            Previously saved: {(row.route.metres / 1609.344).toFixed(1)} miles ·{" "}
            {Math.round(row.route.seconds / 60)} minutes. {row.route.source}
            {row.route.checkedAt
              ? ` · ${new Date(row.route.checkedAt).toLocaleDateString("en-GB")}`
              : ""}
          </p>
        )}
        {row.route?.walkingMetres && (
          <p className="small review-reason">
            Additional estimated walk:{" "}
            {(row.route.walkingMetres / 1000).toFixed(1)} km ·{" "}
            {Math.round((row.route.walkingSeconds || 0) / 60)} minutes one way.{" "}
            {row.route.walkingNote}
          </p>
        )}
        <div className="button-row">
          <a
            className="button"
            href={place.officialUrl}
            target="_blank"
            rel="noreferrer"
          >
            Official visitor information <ArrowUpRight size={14} />
          </a>
          <a
            className="button"
            href={wazeLink(place)}
            target="_blank"
            rel="noreferrer"
          >
            Check in Waze <ArrowUpRight size={14} />
          </a>
        </div>
        <label>
          Review action
          <select
            aria-label="Review action"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            disabled={busy}
          >
            <option value="manual">
              Save a verified distance for {home.label}
            </option>
            <option value="entrance">Correct the entrance for all homes</option>
            <option value="retry">Retry this route calculation</option>
            <option value="flag">Flag this distance as unreliable</option>
          </select>
        </label>
        {action === "manual" && (
          <>
            <div className="form-grid">
              <label>
                Verified distance (miles)
                <input
                  name="miles"
                  type="number"
                  min="0.01"
                  max="6213"
                  step="any"
                  defaultValue={
                    row.route ? (row.route.metres / 1609.344).toFixed(2) : ""
                  }
                  required
                />
              </label>
              <label>
                Travel time (minutes)
                <input
                  name="minutes"
                  type="number"
                  min="0.1"
                  max="16666"
                  step="any"
                  defaultValue={
                    row.route ? Math.round(row.route.seconds / 60) : ""
                  }
                  required
                />
              </label>
            </div>
            <label>
              Route source (shown publicly)
              <input
                name="source"
                maxLength={180}
                placeholder="e.g. Waze, checked at the visitor car park"
                required
              />
            </label>
            <p className="small muted">
              This replaces only the distance from {home.label}. Verify the
              complete road journey; do not enter a straight-line estimate or
              zero for an unreachable place.
            </p>
          </>
        )}
        {action === "entrance" && (
          <>
            <p className="small muted">
              Use a confirmed visitor car park, road entrance or ferry departure
              point. The catalogue marker stays in place; directions and driving
              calculations use this entrance. Every home’s distance to this
              place will be recalculated.
            </p>
            <LocationPin
              {...position}
              entrance
              onChange={(lat, lng) => setPosition({ lat, lng })}
            />
            <div className="form-grid">
              <label>
                Entrance latitude
                <input
                  type="number"
                  min="49"
                  max="61"
                  step="any"
                  value={position.lat}
                  onChange={(e) =>
                    setPosition({ ...position, lat: Number(e.target.value) })
                  }
                  required
                />
              </label>
              <label>
                Entrance longitude
                <input
                  type="number"
                  min="-9"
                  max="3"
                  step="any"
                  value={position.lng}
                  onChange={(e) =>
                    setPosition({ ...position, lng: Number(e.target.value) })
                  }
                  required
                />
              </label>
            </div>
            <label>
              Source used to verify the entrance
              <input
                name="sourceUrl"
                defaultValue={row.entranceSourceUrl}
                type="url"
                placeholder="https://www.nationaltrust.org.uk/…"
                required
              />
            </label>
            <label>
              Public access note
              <textarea
                name="publicNote"
                maxLength={600}
                defaultValue={place.accessNote || ""}
                placeholder="e.g. Park here, then continue on foot. Ferry booking is required."
              />
            </label>
          </>
        )}
        {action === "retry" && (
          <p className="small muted">
            Recalculate this destination from {home.label}, using the saved
            entrance. Other distances are kept. This sends the starting
            coordinates to OSRM / FOSSGIS. A road-to-destination gap over 1 km
            is saved with an additional walking estimate at 4 km/h and a public
            note. Known boat crossings still need a departure-point review.
          </p>
        )}
        {action === "flag" && (
          <>
            <label>
              What needs checking?
              <textarea
                name="reason"
                required
                maxLength={600}
                defaultValue={row.reason}
              />
            </label>
            <p className="small muted">
              The old value is retained for review and stops contributing to
              route ordering until resolved.
            </p>
          </>
        )}
        <label>
          Private review notes
          <textarea
            name="note"
            maxLength={2000}
            defaultValue={row.reviewNote}
            placeholder="Evidence, access restrictions, or what still needs checking."
          />
        </label>
        <p className="small muted">
          Saving queues a website publish. Corrected entrances, public access
          notes and verified distances are included; these review notes and
          exact home coordinates stay local.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="button-row">
          <button className="button primary" disabled={busy}>
            {busy ? (
              <>
                <LoaderCircle className="spin" size={16} />
                Saving…
              </>
            ) : action === "entrance" ? (
              "Save entrance and recalculate"
            ) : action === "retry" ? (
              "Retry route and publish"
            ) : (
              "Save review and publish"
            )}
          </button>
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}

export default function DistanceReview({
  homes,
  currentId,
  places,
  selection,
  onRefresh,
}: {
  homes: Home[];
  currentId: string | null;
  places: Place[];
  selection: ReviewSelection | null;
  onRefresh: () => Promise<void>;
}) {
  const [homeId, setHomeId] = useState(currentId || homes[0]?.id || ""),
    [rows, setRows] = useState<ReviewRow[]>([]),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [loading, setLoading] = useState(false),
    [filter, setFilter] = useState("needs-review"),
    [query, setQuery] = useState(""),
    [limit, setLimit] = useState(20),
    [editing, setEditing] = useState<ReviewRow | null>(null);
  const home = homes.find((h) => h.id === homeId),
    section = useRef<HTMLElement>(null),
    requestId = useRef(0),
    loadedHome = useRef("");
  const load = useCallback(async () => {
    if (!homeId) return;
    const id = ++requestId.current;
    setLoading(true);
    try {
      const data = await api.request<{ rows: ReviewRow[] }>(
        `/api/distance-review?homeId=${encodeURIComponent(homeId)}`,
      );
      if (id === requestId.current) {
        loadedHome.current = homeId;
        setRows(data.rows);
        setError("");
      }
    } catch (e) {
      if (id === requestId.current) setError((e as Error).message);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [homeId]);
  useEffect(() => {
    void load();
  }, [load, homes, places]);
  useEffect(() => {
    if (!homes.some((h) => h.id === homeId))
      setHomeId(currentId || homes[0]?.id || "");
  }, [homes, currentId, homeId]);
  useEffect(() => {
    if (selection) {
      setHomeId(selection.homeId);
      setFilter("all");
      setQuery("");
      section.current?.scrollIntoView({ block: "start" });
    }
  }, [selection]);
  const opened = useRef(0);
  useEffect(() => {
    if (
      selection &&
      selection.serial !== opened.current &&
      selection.homeId === homeId &&
      loadedHome.current === homeId &&
      !loading
    ) {
      const row = rows.find((r) => r.placeId === selection.placeId);
      if (row) {
        opened.current = selection.serial;
        setEditing(row);
      }
    }
  }, [selection, homeId, loading, rows]);
  useEffect(() => setLimit(20), [query, filter, homeId]);
  const filtered = rows.filter(
    (r) =>
      (filter === "all" || r.status === filter) &&
      r.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  if (!homes.length) return null;
  return (
    <section className="distance-review-section" ref={section}>
      <div>
        <h3>Review driving distances</h3>
        <p className="small muted">
          Resolve failed routes, correct visitor entrances or check a suspicious
          saved distance. Corrections are saved locally and automatically queued
          for publishing.
        </p>
      </div>
      <div className="review-filters">
        <label>
          Distances from
          <select
            aria-label="Distances from"
            value={homeId}
            onChange={(e) => {
              setHomeId(e.target.value);
              setRows([]);
              setEditing(null);
            }}
          >
            {homes.map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Show distances
          <select
            aria-label="Show distances"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="needs-review">
              Needs review (
              {rows.filter((r) => r.status === "needs-review").length})
            </option>
            <option value="missing">Missing distances</option>
            <option value="resolved">Resolved reviews</option>
            <option value="all">All distances</option>
          </select>
        </label>
        <label>
          Find a place to review
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (e.target.value) setFilter("all");
            }}
          />
        </label>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="review-result">
          {message}
        </p>
      )}
      {loading ? (
        <p className="small muted">Loading distances…</p>
      ) : (
        <>
          <p className="small muted">
            {filtered.length} {filtered.length === 1 ? "place" : "places"} ·{" "}
            {home?.label}
          </p>
          <div className="review-list">
            {filtered.slice(0, limit).map((row) => (
              <article className="review-row" key={row.placeId}>
                <div>
                  <h4>{row.name}</h4>
                  <BoatNotice
                    place={places.find((p) => p.id === row.placeId)}
                  />
                  <p className="small muted">
                    {row.reason ||
                      (row.route
                        ? `${(row.route.metres / 1609.344).toFixed(1)} miles · ${Math.round(row.route.seconds / 60)} minutes · ${row.route.source}`
                        : "")}
                  </p>
                  {row.route?.walkingMetres && (
                    <p className="small">
                      + approx. {(row.route.walkingMetres / 1000).toFixed(1)} km
                      walk · {Math.round((row.route.walkingSeconds || 0) / 60)}{" "}
                      minutes one way
                    </p>
                  )}
                </div>
                <span className={`review-badge ${row.status}`}>
                  {labels[row.status]}
                </span>
                <button className="button" onClick={() => setEditing(row)}>
                  Review <span className="visually-hidden">{row.name}</span>
                </button>
              </article>
            ))}
          </div>
          {!filtered.length && (
            <p className="small muted">
              No distances match this view. Choose All distances or search for a
              place to review.
            </p>
          )}
          {filtered.length > limit && (
            <button className="button" onClick={() => setLimit((n) => n + 20)}>
              Show more distances
            </button>
          )}
        </>
      )}
      {editing && home && places.some((p) => p.id === editing.placeId) && (
        <ReviewDialog
          key={home.id + editing.placeId}
          row={editing}
          home={home}
          place={places.find((p) => p.id === editing.placeId)!}
          onClose={() => setEditing(null)}
          onSaved={async (message) => {
            setMessage(message);
            await onRefresh();
            await load();
          }}
        />
      )}
    </section>
  );
}

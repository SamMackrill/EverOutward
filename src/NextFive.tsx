import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Camera,
  Check,
  ChevronRight,
  Compass,
  Route as RouteIcon,
} from "lucide-react";
import BoatNotice from "./BoatNotice";
import { PhotoCredit, WalkingEstimate } from "./shared";
import { duration, miles } from "./format";
import { haversine, wazeLink } from "../server/domain.mjs";
import type { Home, Place, Route } from "./types";

export type Ranked = Place & Route;
export type Progress = {
  ranked: Ranked[];
  complete: boolean;
  blockingPendingCount: number;
  remainingCount: number;
};

/** A destination's licensed photo that can be retried when it fails to load. */
function DestinationPhoto({
  place,
  eager,
  onSelect,
  children,
}: {
  place: Ranked;
  eager: boolean;
  onSelect: () => void;
  children?: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setFailed(false);
    setRetry(0);
  }, [place.id, place.image]);
  return (
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
          loading={eager ? "eager" : "lazy"}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="destination-no-photo">
          <Camera size={24} />
          {place.image ? "Photo could not load · Retry" : "Photo to follow"}
        </span>
      )}
      {children}
    </button>
  );
}

/** One of the next five; the first card adds opening times and directions. */
function DestinationCard({
  place,
  index,
  onSelect,
}: {
  place: Ranked;
  index: number;
  onSelect: () => void;
}) {
  return (
    <article
      className={`destination-card ${index === 0 ? "first-destination" : ""}`}
    >
      <DestinationPhoto place={place} eager={index === 0} onSelect={onSelect}>
        <span className="destination-number">{index + 1}</span>
        {index === 0 && <span className="next-gate-label">Your next gate</span>}
      </DestinationPhoto>
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

/**
 * A small next-gate summary for places where the full rail doesn't fit: above
 * the map on phones. The page heading already names the place there.
 */
export function NextGateCompact({
  place,
  onSelect,
}: {
  place: Ranked;
  onSelect: () => void;
}) {
  return (
    <div className="next-gate-compact">
      <DestinationPhoto place={place} eager onSelect={onSelect}>
        <span className="destination-number">1</span>
      </DestinationPhoto>
      <div>
        <p className="destination-distance">
          <RouteIcon size={13} />
          {miles(place.metres)} mi by road{" "}
          <span>· {duration(place.seconds)}</span>
        </p>
        <BoatNotice place={place} />
        <div className="next-gate-actions">
          <a
            className="button primary"
            href={wazeLink(place)}
            target="_blank"
            rel="noreferrer"
          >
            Waze <ArrowUpRight size={15} />
          </a>
          <button className="text-button" onClick={onSelect}>
            Plan this visit <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** The map view's side rail: the next five, routing notes and nearby places. */
export default function NextFive({
  progress,
  hasQueue,
  owner,
  hasPlaces,
  nearby,
  home,
  onSelect,
  onNavigate,
}: {
  progress: Progress;
  hasQueue: boolean;
  owner: boolean;
  hasPlaces: boolean;
  nearby: Place[];
  home: Home | null;
  onSelect: (place: Place) => void;
  onNavigate: (view: string) => void;
}) {
  return (
    <aside className="journey-sidebar">
      <div className="sidebar-head">
        <h2>The next five</h2>
        <p>
          Our next adventure begins with the nearest place we haven’t visited.
        </p>
      </div>
      {progress.remainingCount === 0 && hasPlaces ? (
        <div className="public-note">
          <Check size={28} />
          <h3>Every gate explored</h3>
          <p>
            You’ve visited every place in the current catalogue. Your memories
            are waiting in the timeline.
          </p>
        </div>
      ) : owner || hasQueue ? (
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
                {progress.ranked.map((p, index) => (
                  <DestinationCard
                    key={p.id}
                    place={p}
                    index={index}
                    onSelect={() => onSelect(p)}
                  />
                ))}
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
                . Times exclude live traffic. Check the visitor entrance and
                opening days before travelling.{" "}
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
                Calculate free driving estimates to find the nearest unvisited
                places.
              </p>
              <button
                className="text-button"
                onClick={() => onNavigate("settings")}
              >
                Set up driving distances <ChevronRight size={15} />
              </button>
            </div>
          )}
          {!progress.complete && (
            <p className="route-note">
              {progress.blockingPendingCount} nearby unvisited places still need
              a route. We won’t call a place “nearest” until the ranking is
              complete.
            </p>
          )}
        </>
      ) : (
        <div className="public-note">
          <Compass size={28} />
          <h3>A journey that grows from home</h3>
          <p>
            We visit the nearest National Trust place we haven’t explored yet.
            Follow the memories as our world gets a little wider.
          </p>
          <button className="button" onClick={() => onNavigate("timeline")}>
            Explore our timeline <ChevronRight size={16} />
          </button>
        </div>
      )}
      {owner && home && nearby.length > 0 && (
        <div className="nearby">
          <h3>Around your home</h3>
          <p className="small muted">
            Straight-line discovery · not the driving queue
          </p>
          {nearby.map((p) => (
            <button key={p.id} onClick={() => onSelect(p)}>
              <span>{p.name}</span>
              <span>{miles(haversine(home, p))} mi</span>
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
  );
}

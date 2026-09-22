import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, ChevronRight, Plus, Search, Users } from "lucide-react";
import BoatNotice from "./BoatNotice";
import Link from "./navigation";
import { EmptyPhoto, PhotoImage, Stars } from "./shared";
import { date, ordinal } from "./format";
import { photoSource } from "../server/photo-links.mjs";
import { sortVisits } from "../server/domain.mjs";
import type { Place, Visit } from "./types";

const coverPhoto = (v: Visit) =>
  v.photos.find((p) => p.id === v.coverId && photoSource(p)) ||
  v.photos.find((p) => photoSource(p));

function Cover({ visit, place }: { visit: Visit; place?: Place }) {
  const photo = coverPhoto(visit);
  // A cover that stops loading falls back to the place's licensed photo.
  const placePhoto = place?.image ? (
    <img src={place.image} alt="" loading="lazy" />
  ) : (
    <EmptyPhoto />
  );
  return photo ? (
    <PhotoImage photo={photo} alt="" fallback={placePhoto} />
  ) : (
    <EmptyPhoto />
  );
}

export default function Timeline({
  hidden,
  visits,
  places,
  owner,
  currentHomeLabel,
  onRecord,
}: {
  hidden: boolean;
  visits: Visit[];
  places: Place[];
  owner: boolean;
  currentHomeLabel?: string;
  onRecord: () => void;
}) {
  const [query, setQuery] = useState(""),
    [person, setPerson] = useState(""),
    [limit, setLimit] = useState(20);
  const placeById = useMemo(
    () => new globalThis.Map(places.map((p) => [p.id, p])),
    [places],
  );
  const sorted: Visit[] = useMemo(() => sortVisits(visits), [visits]);
  // Which visit to the place this was: the first, the 2nd, the 9th…
  const visitNumber = useMemo(() => {
    const seen = new globalThis.Map<string, number>(),
      numbers = new globalThis.Map<string, number>();
    for (const v of [...sorted].reverse()) {
      const n = (seen.get(v.placeId) || 0) + 1;
      seen.set(v.placeId, n);
      numbers.set(v.id, n);
    }
    return numbers;
  }, [sorted]);
  const people = useMemo(() => {
    const counts = new globalThis.Map<string, number>();
    for (const v of visits)
      for (const name of v.attendees || [])
        counts.set(name, (counts.get(name) || 0) + 1);
    return [...counts]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name]) => name);
  }, [visits]);
  const shown = useMemo(
    () =>
      sorted.filter((v) => {
        const p = placeById.get(v.placeId);
        return (
          (!person || v.attendees?.includes(person)) &&
          (!query ||
            `${p?.name} ${v.title} ${v.summary} ${v.notes} ${(v.attendees || []).join(" ")}`
              .toLowerCase()
              .includes(query.toLowerCase()))
        );
      }),
    [sorted, placeById, person, query],
  );
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || hidden) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting)
          setLimit((n) => Math.min(n + 20, shown.length));
      },
      { rootMargin: "300px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hidden, shown.length, limit]);
  const filtered = !!(query || person);
  return (
    <div className="timeline-view content-scroll" hidden={hidden}>
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
            setLimit(20);
          }}
        />
      </label>
      {people.length > 1 && (
        <div className="person-filter" role="group" aria-label="Who came">
          {["", ...people].map((name) => (
            <button
              key={name || "everyone"}
              className="chip"
              aria-pressed={person === name}
              onClick={() => {
                setPerson(name);
                setLimit(20);
              }}
            >
              {name || "Everyone"}
            </button>
          ))}
        </div>
      )}
      {!shown.length ? (
        <div className="empty-state">
          <img src="/icons/gate.svg" alt="" />
          <h3>
            {filtered
              ? "No matching memories"
              : "Every story starts with a first visit"}
          </h3>
          <p>
            {filtered
              ? "Try another place name or word from your journal."
              : "The walks, the gardens, the unexpected discoveries. They’ll all find a home here."}
          </p>
          {owner && !filtered && (
            <button className="button primary" onClick={onRecord}>
              <Plus size={17} />
              Record your first visit
            </button>
          )}
        </div>
      ) : (
        <div className="timeline-list">
          {shown.slice(0, limit).map((v, index) => {
            const p = placeById.get(v.placeId),
              month = v.date.slice(0, 7),
              prev = shown[index - 1]?.date.slice(0, 7),
              number = visitNumber.get(v.id) || 1,
              origin =
                v.startingHomeLabel || v.startingHomeSnapshot?.label || "";
            return (
              <div key={v.id}>
                {month !== prev && (
                  <h2 className="month-label">
                    {new Date(v.date + "T12:00:00").toLocaleDateString(
                      "en-GB",
                      { month: "long", year: "numeric" },
                    )}
                  </h2>
                )}
                <article className="visit-card">
                  <div className="visit-image" aria-hidden="true">
                    <Cover visit={v} place={p} />
                  </div>
                  <div>
                    <p className="eyebrow">
                      {date(v.date)}
                      {owner
                        ? ` · ${v.publicationStatus || (v.published ? "Ready to publish" : "Only on this computer")}`
                        : ""}
                    </p>
                    <h3>
                      <Link to={"visit/" + v.id} className="visit-card-link">
                        {v.title || p?.name}
                      </Link>
                    </h3>
                    {v.title && <p className="small muted">{p?.name}</p>}
                    {(v.rating || number > 1) && (
                      <p className="visit-card-rating">
                        <Stars value={v.rating} />
                        {number > 1 && (
                          <span className="repeat-badge">
                            {ordinal(number)} visit
                          </span>
                        )}
                      </p>
                    )}
                    <BoatNotice place={p} />
                    {(v.photos.length > 0 ||
                      !!v.attendees?.length ||
                      (origin && origin !== currentHomeLabel)) && (
                      <p className="visit-facts">
                        {v.photos.length > 0 && (
                          <span>
                            <Camera size={14} aria-hidden="true" />
                            {v.photos.length}{" "}
                            {v.photos.length === 1 ? "photo" : "photos"}
                          </span>
                        )}
                        {!!v.attendees?.length && (
                          <span>
                            <Users size={14} aria-hidden="true" />
                            With {v.attendees.join(", ")}
                          </span>
                        )}
                        {origin && origin !== currentHomeLabel && (
                          <span>From {origin}</span>
                        )}
                      </p>
                    )}
                    {(v.summary || v.notes.trim()) && (
                      <p>{v.summary || v.notes.slice(0, 220)}</p>
                    )}
                    <span className="read-more" aria-hidden="true">
                      Read the full visit <ChevronRight size={15} />
                    </span>
                  </div>
                </article>
              </div>
            );
          })}
        </div>
      )}
      <div ref={sentinel} />
      {shown.length > limit ? (
        <button className="button" onClick={() => setLimit((n) => n + 20)}>
          Load older visits
        </button>
      ) : shown.length > 0 ? (
        <p className="timeline-end">
          You’ve reached your first visit. Here’s to the next one.
        </p>
      ) : null}
    </div>
  );
}

import { useState } from "react";
import { CalendarDays, LoaderCircle } from "lucide-react";
import { shortDate } from "./format";
import * as api from "./api";
import type { AccessDates, Place } from "./types";

const accessDateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function availableAccess(place: Place) {
  const today = accessDateFormat.format(new Date());
  const dates = (place.accessDates?.dates || []).filter((d) => d.date >= today);
  const newDates = dates.filter((d) =>
    place.accessDates?.newDates.includes(d.date),
  );
  return { dates, newDates };
}

/** A text label as well as a dotted visual, including on visited properties. */
export default function AccessNotice({ place }: { place: Place }) {
  if (!place.limitedAccess) return null;
  const { newDates } = availableAccess(place);
  return (
    <span
      className={`limited-access-badge ${newDates.length ? "important" : ""}`}
    >
      <CalendarDays size={14} aria-hidden="true" />
      {newDates.length
        ? "Important · new opening dates"
        : "Limited access · special open days"}
    </span>
  );
}

/** Visitor-facing access explanation with saved calendar checks and owner actions. */
export function AccessDetail({
  place,
  owner,
  onChange,
}: {
  place: Place;
  owner: boolean;
  onChange?: (entries: AccessDates[]) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [checked, setChecked] = useState(false);
  if (!place.limitedAccess) return null;
  const status = place.accessDates;
  const { dates, newDates } = availableAccess(place);
  const stale =
    !!status?.checkedAt &&
    Date.now() - Date.parse(status.checkedAt) > 48 * 60 * 60 * 1000;
  const act = async (acknowledge: boolean) => {
    setBusy(true);
    setError("");
    setChecked(false);
    try {
      const result = await api.request<{ entries: AccessDates[] }>(
        acknowledge
          ? `/api/access-dates/${place.id}/acknowledge`
          : "/api/access-dates/check",
        {
          method: "POST",
          body: JSON.stringify(
            acknowledge ? { dates: newDates.map((d) => d.date) } : {},
          ),
        },
      );
      onChange?.(result.entries);
      setChecked(!acknowledge);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className={`limited-access-detail ${newDates.length ? "important" : ""}`}
      aria-label="Limited access and opening dates"
    >
      <AccessNotice place={place} />
      <p>{place.limitedAccessNote}</p>
      <p>
        <strong>This place does not hold back your discovery circle.</strong> It
        stays in the next five by straight-line distance, and recording a visit
        here still counts towards your progress.
      </p>
      <h3>
        {newDates.length
          ? "Important · new opening dates announced"
          : "Announced opening dates"}
      </h3>
      {dates.length ? (
        <>
          <ul className="access-date-list">
            {dates.slice(0, 12).map((d) => (
              <li key={d.date}>
                <span>
                  <time dateTime={d.date}>{shortDate(d.date)}</time>
                  {newDates.some((n) => n.date === d.date) && (
                    <strong className="access-new">New</strong>
                  )}
                </span>
                <small>{d.hours}</small>
              </li>
            ))}
          </ul>
          {dates.length > 12 && (
            <p className="small">
              {dates.length - 12} more dates are listed on the official
              calendar.
            </p>
          )}
          <p className="small">
            Confirm opening times and any booking requirements with the National
            Trust before travelling.
          </p>
        </>
      ) : (
        <p>
          {status?.checkedAt
            ? "No upcoming opening dates were found in the last successful calendar check. Dates may be announced later; this does not mean the place is permanently closed."
            : "Opening dates have not been checked yet. Use the official calendar to plan a visit."}
        </p>
      )}
      {(status?.error || stale) && (
        <p className="access-check-warning" role="status">
          {status?.error
            ? `The latest check failed: ${status.error}`
            : "These dates were last checked more than two days ago."}
          {dates.length > 0 &&
            " The dates above come from the last successful check and may have changed."}
        </p>
      )}
      <p className="small muted">
        {status?.checkedAt
          ? `Last successful check: ${new Date(status.checkedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}. `
          : ""}
        {owner
          ? "Checked daily while the local server is running; missed checks resume when it starts. Updates appear here automatically."
          : "These are saved checks from the owner’s journal and update when the journal is published."}
      </p>
      <div className="button-row">
        <a
          className="button"
          href={`${place.accessSource || place.officialUrl}#place-opening-times`}
          target="_blank"
          rel="noreferrer"
        >
          Check official opening dates
        </a>
        {owner && onChange && (
          <button
            className="button"
            disabled={busy}
            onClick={() => void act(false)}
          >
            {busy && <LoaderCircle size={14} className="spin" />}Check dates now
          </button>
        )}
        {owner && onChange && newDates.length > 0 && (
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void act(true)}
          >
            Mark these dates as seen
          </button>
        )}
      </div>
      {checked && (
        <p className="small" role="status">
          Calendar check finished. Checks are spaced at least one minute apart.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function AccessAlerts({
  places,
  onSelect,
}: {
  places: Place[];
  onSelect: (place: Place) => void;
}) {
  const updates = places.filter(
    (p) => p.limitedAccess && availableAccess(p).newDates.length,
  );
  if (!updates.length) return null;
  return (
    <aside
      className="access-updates"
      aria-label="Important opening date updates"
      aria-live="polite"
    >
      <strong>
        <CalendarDays size={17} aria-hidden="true" />
        Important · new opening dates
      </strong>
      <div>
        {updates.map((p) => (
          <button
            className="text-button"
            key={p.id}
            onClick={() => onSelect(p)}
          >
            {p.name} · {shortDate(availableAccess(p).newDates[0].date)}
          </button>
        ))}
      </div>
    </aside>
  );
}

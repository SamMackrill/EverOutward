import { useState } from "react";
import {
  ArrowUpRight,
  Download,
  Globe,
  LoaderCircle,
  Settings,
} from "lucide-react";
import HomeLocations from "./HomeLocations";
import DistanceReview from "./DistanceReview";
import { HowItWorks } from "./shared";
import { date } from "./format";
import * as api from "./api";
import type { Publisher } from "./usePublish";
import type { Home, HomeJourney, Place, Visit } from "./types";

// Short labels for the server's publication statuses.
const statuses: Record<string, { label: string; tone: string }> = {
  Published: { label: "Published", tone: "published" },
  "Changes not yet published": { label: "Changed", tone: "pending" },
  "Ready to publish": { label: "New", tone: "pending" },
  "Removal pending publish": { label: "Removing", tone: "pending" },
  "Only on this computer": { label: "Private", tone: "private" },
};
const filters = [
  { value: "all", label: "All visits" },
  { value: "pending", label: "Not yet published" },
  { value: "private", label: "Private" },
  { value: "published", label: "Published" },
];

/** Owner settings: publishing, homes, distance review and backups. */
export default function Workspace({
  visits,
  home,
  homes,
  homeJourneys,
  places,
  changes,
  publisher,
  onRefresh,
  notify,
}: {
  visits: Visit[];
  home: Home | null;
  homes: Home[];
  homeJourneys: HomeJourney[];
  places: Place[];
  changes: number;
  publisher: Publisher;
  onRefresh: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const { job, site, busy, publish } = publisher;
  const [error, setError] = useState(""),
    // Visits whose publishing choice is being saved, and the choice shown.
    [saving, setSaving] = useState<Map<string, boolean>>(new Map()),
    [filter, setFilter] = useState("all"),
    [calculating, setCalculating] = useState(false),
    [reviewSelection, setReviewSelection] = useState<{
      homeId: string;
      placeId: string;
      serial: number;
    } | null>(null);
  /** The short label and colour for a visit's publication status. */
  const status = (visit: Visit) =>
    statuses[visit.publicationStatus || ""] || statuses["Ready to publish"];
  /** The visit's title, or its place name when it has none. */
  const name = (visit: Visit) =>
    visit.title || places.find((p) => p.id === visit.placeId)?.name || "visit";
  const excluded = visits.filter((v) => !v.published);
  const shown = visits.filter(
    (v) => filter === "all" || status(v).tone === filter,
  );
  /** Saves the publishing choice for some visits, one row at a time or all together. */
  const choose = async (chosen: Visit[], published: boolean) => {
    setSaving((current) => {
      const next = new Map(current);
      for (const v of chosen) next.set(v.id, published);
      return next;
    });
    setError("");
    try {
      if (chosen.length === 1)
        await api.request(`/api/visits/${chosen[0].id}/publication`, {
          method: "PATCH",
          body: JSON.stringify({
            published,
            updatedAt: chosen[0].updatedAt,
          }),
        });
      else
        await api.request("/api/visits/publication", {
          method: "PATCH",
          body: JSON.stringify({
            published,
            visits: chosen.map(({ id, updatedAt }) => ({ id, updatedAt })),
          }),
        });
      await onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving((current) => {
        const next = new Map(current);
        for (const v of chosen) next.delete(v.id);
        return next;
      });
    }
  };
  return (
    <div className="content-scroll settings-view">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Local owner workspace</p>
          <h1 className="view-title">A home for your adventures</h1>
        </div>
        <Settings size={26} />
      </div>
      <section className="settings-section publish-section">
        <div>
          <h3>Your public here.now site</h3>
          <p>Publish your selected visits, cover photos and summaries.</p>
          <HowItWorks>
            <p>
              New guest comments appear immediately. Remove comments through the
              visit detail in this workspace. Publishing keeps your local notes
              and photos and makes a private backup first.
            </p>
            <p>
              Reuses this project’s dedicated site. Excluded visits, exact home
              coordinates and account credentials stay local.
            </p>
          </HowItWorks>
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
          <p className="publish-changes">
            {changes
              ? `${changes} ${changes === 1 ? "change" : "changes"} not yet published`
              : "The public journal is up to date"}
          </p>
          <button
            className="button primary"
            onClick={publish}
            disabled={busy || calculating || saving.size > 0}
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
            {publisher.connectionError && <p>{publisher.connectionError}</p>}
          </div>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          {publisher.failed && (
            <p role="alert" className="form-error">
              {publisher.error} Your local visits are safe. You can retry
              publishing.
            </p>
          )}
          <p className="small">
            {visits.length - excluded.length} visits included ·{" "}
            {excluded.length} excluded from publishing.
          </p>
          <details className="publish-selection">
            <summary>Choose visits to publish</summary>
            <p className="small muted">
              Unchecked visits stay on this computer. Unchecking a public visit
              removes it at the next publish.
            </p>
            <div className="publish-tools">
              <label>
                <span className="visually-hidden">Show</span>
                <select
                  aria-label="Show visits"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  {filters.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
              {excluded.length > 0 && (
                <button
                  className="button quiet"
                  disabled={busy || saving.size > 0}
                  onClick={() => choose(excluded, true)}
                >
                  Include all {excluded.length} private{" "}
                  {excluded.length === 1 ? "visit" : "visits"}
                </button>
              )}
            </div>
            {shown.map((visit) => (
              <label className="checkbox publish-row" key={visit.id}>
                <input
                  type="checkbox"
                  aria-label={`Include ${name(visit)} in next publish`}
                  checked={saving.get(visit.id) ?? visit.published}
                  disabled={busy || saving.has(visit.id)}
                  onChange={(e) => choose([visit], e.target.checked)}
                />
                <span>
                  {name(visit)}
                  <small className="muted">{date(visit.date)}</small>
                </span>
                <span className={`status-pill ${status(visit).tone}`}>
                  {status(visit).label}
                </span>
              </label>
            ))}
            {!shown.length && (
              <p className="small muted">No visits match this filter.</p>
            )}
          </details>
        </div>
      </section>
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

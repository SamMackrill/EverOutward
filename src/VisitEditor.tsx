import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Check, ImagePlus, LoaderCircle } from "lucide-react";
import Modal from "./Modal";
import VisitPhotoEditor, { PhotoLibraries } from "./VisitPhotoEditor";
import PhotoDropZone from "./PhotoDropZone";
import AlbumImport from "./AlbumImport";
import { MAX_VISIT_PHOTOS, photoIdentity } from "../server/photo-albums.mjs";
import { photoSource } from "../server/photo-links.mjs";
import type { Home, Photo, Place, Visit } from "./types";

export default function VisitEditor({
  focus,
  visit,
  defaultPlace,
  homes,
  currentHome,
  places,
  onClose,
  onSave,
}: {
  focus?: "photos" | "story";
  visit: Visit | null;
  defaultPlace?: string;
  homes: Home[];
  currentHome: Home | null;
  places: Place[];
  onClose: () => void;
  onSave: (
    v: Omit<Visit, "id" | "createdAt" | "updatedAt"> & { updatedAt?: string },
  ) => Promise<void>;
}) {
  const [origin, setOrigin] = useState(() => ({
    id: visit?.startingHomeId || currentHome?.id || "",
    version: visit?.startingHomeVersion || currentHome?.version || "",
  }));
  const [photos, setPhotos] = useState<Photo[]>(visit?.photos || []),
    [coverId, setCoverId] = useState<string | null>(visit?.coverId || null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const photoSection = useRef<HTMLDivElement>(null),
    story = useRef<HTMLTextAreaElement>(null),
    form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const target = focus === "photos" ? photoSection : story;
    if (!focus) return;
    const frame = requestAnimationFrame(() => {
      target.current?.scrollIntoView({ block: "start" });
      target.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focus]);
  // Compare the form with its first render so an untouched editor closes
  // without asking.
  const snapshot = () =>
    JSON.stringify([
      form.current
        ? [...new FormData(form.current)].filter(
            ([, value]) => typeof value === "string",
          )
        : [],
      origin,
      coverId,
    ]);
  const initial = useRef<{ form: string; photos: Photo[] } | null>(null);
  useEffect(() => {
    initial.current = { form: snapshot(), photos };
  }, []);
  const isDirty = () =>
    !!initial.current &&
    (photos !== initial.current.photos || snapshot() !== initial.current.form);
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
        startingHomeId: origin.id,
        startingHomeVersion: origin.version,
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
      isDirty={isDirty}
      wide
    >
      {(requestClose) => (
        <form className="form-stack" onSubmit={submit} ref={form}>
          <label>
            Started from
            <select
              aria-label="Started from"
              required
              value={origin.id}
              onChange={(e) => {
                const h = homes.find((h) => h.id === e.target.value);
                if (h) setOrigin({ id: h.id, version: h.version });
              }}
            >
              <option value="">Choose a starting home</option>
              {homes.map((h) => (
                <option value={h.id} key={h.id}>
                  {h.label}
                </option>
              ))}
              {visit?.startingHomeId &&
                !homes.some((h) => h.id === visit.startingHomeId) && (
                  <option value={visit.startingHomeId}>
                    {visit.startingHomeLabel ||
                      visit.startingHomeSnapshot?.label ||
                      "Previous home"}{" "}
                    (removed)
                  </option>
                )}
            </select>
            <span className="optional">
              This trip keeps its starting location when the current home
              changes.
            </span>
          </label>
          {!homes.length && (
            <p className="form-error">
              Add a home location in Workspace before recording a visit.
            </p>
          )}
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
              ref={story}
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
                defaultChecked={visit?.published ?? true}
              />
              Include in the public journal when published
            </label>
            <p className="small muted">
              Saving keeps this visit on this computer until you press Publish
              in Workspace. Uncheck this option to keep it private and exclude
              it from publishing.
            </p>
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
                  current.map((item) =>
                    item.id === photo.id ? updated : item,
                  ),
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
            <button className="button" type="button" onClick={requestClose}>
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
      )}
    </Modal>
  );
}

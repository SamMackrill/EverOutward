import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Camera,
  ImagePlus,
  Map,
  MapPin,
  MessageCircle,
  LoaderCircle,
  Home as HomeIcon,
  Pencil,
  Share2,
  Trash2,
  Users,
} from "lucide-react";
import Modal from "./Modal";
import BoatNotice from "./BoatNotice";
import VisitCarousel from "./VisitCarousel";
import { PhotoImage, Stars } from "./shared";
import { date } from "./format";
import { photoSource, providerFor } from "../server/photo-links.mjs";
import { albumLink } from "../server/photo-albums.mjs";
import { wazeLink } from "../server/domain.mjs";
import * as api from "./api";
import type { Comment, Photo, Place, Visit } from "./types";

const GALLERY_START = 12;

/** Displays a visit's story, photos, navigation, and owner actions. */
export default function VisitDetail({
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
  onEdit: (focus?: "story") => void;
  onAddPhotos: () => void;
  onDelete: () => Promise<void>;
}) {
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null),
    [confirm, setConfirm] = useState(false),
    [deleteError, setDeleteError] = useState(""),
    [showAll, setShowAll] = useState(false),
    [failed, setFailed] = useState<Set<string>>(new Set()),
    [noteCount, setNoteCount] = useState(0),
    [shared, setShared] = useState("");
  const album = albumLink(visit.photos);
  // Previews that can't load are summarised once instead of as grey tiles.
  const previewable = visit.photos.filter(
      (p) => photoSource(p) && !failed.has(p.id),
    ),
    unavailable = visit.photos.filter(
      (p) => p.kind !== "album" && !previewable.includes(p),
    ).length,
    gallery = showAll ? previewable : previewable.slice(0, GALLERY_START);
  const origin = visit.startingHomeLabel || visit.startingHomeSnapshot?.label;
  /** Opens the share sheet, or copies the visit link where sharing isn't available. */
  const share = async () => {
    const title = document.title;
    try {
      if (navigator.share) {
        await navigator.share({ title, url: location.href });
        return;
      }
      await navigator.clipboard.writeText(location.href);
      setShared("Link copied");
    } catch (e) {
      if ((e as Error).name !== "AbortError") setShared("Copy failed");
    }
  };
  useEffect(() => {
    if (!shared) return;
    const t = setTimeout(() => setShared(""), 2500);
    return () => clearTimeout(t);
  }, [shared]);
  return (
    <article className="visit-detail content-scroll">
      <div className="detail-nav">
        <button className="text-button" onClick={onBack}>
          <ArrowLeft size={17} />
          Back
        </button>
        <div className="button-row">
          <button className="button quiet" onClick={share}>
            <Share2 size={15} />
            <span aria-live="polite">{shared || "Share"}</span>
          </button>
          {owner && (
            <>
              <button className="button quiet" onClick={() => onEdit()}>
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
            </>
          )}
        </div>
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
          {owner
            ? ` · ${visit.publicationStatus || (visit.published ? "Ready to publish" : "Only on this computer")}`
            : ""}
        </p>
        <h1 className="view-title">{visit.title || place?.name}</h1>
        {(visit.title || visit.rating) && (
          <p className="location-line">
            {visit.title && place && (
              <span>
                <MapPin size={16} />
                {place.name}
              </span>
            )}
            <Stars value={visit.rating} />
          </p>
        )}
        <BoatNotice place={place} />
        {(!!visit.attendees?.length || origin || visit.published) && (
          <p className="visit-meta">
            {!!visit.attendees?.length && (
              <span>
                <Users size={15} aria-hidden="true" />
                With {visit.attendees.join(", ")}
              </span>
            )}
            {origin && (
              <span>
                <HomeIcon size={15} aria-hidden="true" />
                From {origin}
              </span>
            )}
            {visit.published && (
              <button
                className="text-button"
                onClick={() =>
                  document
                    .getElementById("visit-notes")
                    ?.scrollIntoView({ behavior: "smooth" })
                }
              >
                <MessageCircle size={15} aria-hidden="true" />
                {noteCount
                  ? `${noteCount} ${noteCount === 1 ? "note" : "notes"}`
                  : "Leave a note"}
              </button>
            )}
          </p>
        )}
        {visit.summary && <p className="visit-lead">{visit.summary}</p>}
        {visit.notes.trim() ? (
          <div className="prose">
            {visit.notes.split("\n").map((line, i) => (
              <p key={i}>{line || "\u00a0"}</p>
            ))}
          </div>
        ) : (
          owner && (
            <button className="story-prompt" onClick={() => onEdit("story")}>
              <Pencil size={16} />
              Add the story of this day
            </button>
          )
        )}
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
        {(owner || visit.photos.length > 0) && (
          <section className="photo-gallery">
            <div className="visit-photo-heading">
              <h3>Photos from this visit</h3>
              {owner ? (
                <button className="button primary" onClick={onAddPhotos}>
                  <ImagePlus size={16} />
                  Add photos
                </button>
              ) : (
                <p className="photo-summary">
                  <Camera size={15} aria-hidden="true" />
                  {visit.photos.length}{" "}
                  {visit.photos.length === 1 ? "photo" : "photos"}
                  {album && (
                    <>
                      {" · "}
                      <a href={album} target="_blank" rel="noreferrer">
                        Open album <ArrowUpRight size={14} />
                      </a>
                    </>
                  )}
                </p>
              )}
            </div>
            {visit.photos.length === 0 && (
              <p className="small muted">
                No photos added yet. Add shared links or images, then choose a
                visit cover.
              </p>
            )}
            <div className="visit-photo-grid">
              {gallery.map((p, i) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedPhoto(p)}
                  aria-label={`View photo and comments: ${p.caption || `photo ${i + 1} of ${previewable.length}`}`}
                >
                  <PhotoImage
                    photo={p}
                    alt={
                      p.caption ||
                      `Photo ${i + 1} of ${previewable.length}, ${place?.name}, ${date(visit.date)}`
                    }
                    onFail={() =>
                      setFailed((current) => new Set(current).add(p.id))
                    }
                  />
                  {p.caption && <span>{p.caption}</span>}
                </button>
              ))}
            </div>
            {previewable.length > gallery.length && (
              <button className="button" onClick={() => setShowAll(true)}>
                Show all {previewable.length} photos
              </button>
            )}
            {unavailable > 0 && (
              <p className="small muted photo-unavailable">
                {unavailable} {unavailable === 1 ? "photo" : "photos"}{" "}
                {album
                  ? `${unavailable === 1 ? "is" : "are"} in the Google Photos album`
                  : "can’t be previewed here"}
                {album && (
                  <>
                    {" "}
                    <a href={album} target="_blank" rel="noreferrer">
                      Open album <ArrowUpRight size={13} />
                    </a>
                  </>
                )}
                {owner && !album && " · Edit the visit to fix their links."}
              </p>
            )}
          </section>
        )}
        {visit.published ? (
          <Comments
            visit={visit}
            photoId={null}
            owner={owner}
            onCount={setNoteCount}
          />
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

/** Lists comments for a visit or photo and provides the comment form. */
function Comments({
  visit,
  photoId,
  owner,
  onCount,
}: {
  visit: Visit;
  photoId: string | null;
  owner: boolean;
  onCount?: (count: number) => void;
}) {
  const [items, setItems] = useState<Comment[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const key = useRef(crypto.randomUUID());
  /** Reloads comments for the selected visit or photo. */
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
  useEffect(() => onCount?.(items.length), [items.length, onCount]);
  /** Posts the current comment form and refreshes the displayed thread. */
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
    <section className="comments" id={photoId ? undefined : "visit-notes"}>
      <div className="section-heading">
        <h3>
          <MessageCircle size={20} />
          {photoId ? "About this photo" : "Notes"}
        </h3>
        <span className="count-label">
          {items.length
            ? `${items.length} ${items.length === 1 ? "note" : "notes"}`
            : "No notes yet — be the first"}
        </span>
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

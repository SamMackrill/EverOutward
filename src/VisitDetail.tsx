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
  Trash2,
  Users,
} from "lucide-react";
import Modal from "./Modal";
import BoatNotice from "./BoatNotice";
import VisitCarousel from "./VisitCarousel";
import { PhotoImage, Stars } from "./shared";
import { date } from "./format";
import { providerFor } from "../server/photo-links.mjs";
import { albumLink } from "../server/photo-albums.mjs";
import { wazeLink } from "../server/domain.mjs";
import * as api from "./api";
import type { Comment, Photo, Place, Visit } from "./types";

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
    [deleteError, setDeleteError] = useState("");
  const album = albumLink(visit.photos);
  return (
    <article className="visit-detail content-scroll">
      <div className="detail-nav">
        <button className="text-button" onClick={onBack}>
          <ArrowLeft size={17} />
          Back
        </button>
        {owner && (
          <div className="button-row">
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
          </div>
        )}
      </div>
      <VisitCarousel
        key={`${visit.id}:${visit.coverId}`}
        photos={visit.photos}
        coverId={visit.coverId}
        suspended={!!selectedPhoto}
        onOpen={setSelectedPhoto}
      />
      <div className="detail-copy">
        <p className="visit-origin">
          <HomeIcon size={15} />
          Started from{" "}
          {visit.startingHomeLabel ||
            visit.startingHomeSnapshot?.label ||
            "location not recorded"}
        </p>
        <p className="eyebrow">
          {date(visit.date)}
          {owner
            ? ` · ${visit.publicationStatus || (visit.published ? "Ready to publish" : "Only on this computer")}`
            : ""}
        </p>
        <h2>{visit.title || place?.name}</h2>
        <p className="location-line">
          <MapPin size={16} />
          {place?.name}
          <Stars value={visit.rating} />
        </p>
        <BoatNotice place={place} />
        {!!visit.attendees?.length && (
          <section
            className="visit-attendees"
            aria-label="People who came along"
          >
            <h3>
              <Users size={17} />
              Who came along
            </h3>
            <ul>
              {visit.attendees.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </section>
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
              {visit.photos.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedPhoto(p)}
                  aria-label={`View photo and comments: ${p.caption || "Visit photo"}`}
                >
                  <PhotoImage photo={p} />
                  <span>
                    {p.caption ||
                      providerFor(p.url)?.name ||
                      (p.kind === "album" ? "Photo album" : "Visit photo")}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
        {visit.published ? (
          <Comments visit={visit} photoId={null} owner={owner} />
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
}: {
  visit: Visit;
  photoId: string | null;
  owner: boolean;
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
    <section className="comments">
      <div className="section-heading">
        <h3>
          <MessageCircle size={20} />
          {photoId ? "About this photo" : "Leave a little note"}
        </h3>
        <span className="count-label">{items.length}</span>
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

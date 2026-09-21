import { useState } from "react";
import { request } from "./api";
import SharedLinkInput from "./SharedLinkInput";
import { MAX_VISIT_PHOTOS, photoIdentity } from "../server/photo-albums.mjs";
import type { Photo } from "./types";

type AlbumPhoto = Omit<Photo, "id"> & { sourceId: string };
export default function AlbumImport({
  photos,
  onAdd,
  onBusy,
}: {
  photos: Photo[];
  onAdd: (photos: Photo[]) => void;
  onBusy: (id: string, busy: boolean) => void;
}) {
  const [url, setUrl] = useState("");
  const [items, setItems] = useState<AlbumPhoto[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const existing = new Set(
    photos.filter((p) => p.url).map((p) => photoIdentity(p.url)),
  );
  const available = items.filter((p) => !existing.has(photoIdentity(p.url)));
  const remaining = MAX_VISIT_PHOTOS - photos.length;
  const chosen = available.filter((p) => selected.has(p.sourceId));
  const load = async () => {
    setBusy(true);
    onBusy("album", true);
    setMessage("");
    setItems([]);
    try {
      const result = await request<{ photos: AlbumPhoto[]; message: string }>(
        "/api/photo-links/album",
        { method: "POST", body: JSON.stringify({ url }) },
      );
      setItems(result.photos);
      setSelected(
        new Set(
          result.photos
            .filter((p) => !existing.has(photoIdentity(p.url)))
            .slice(0, remaining)
            .map((p) => p.sourceId),
        ),
      );
      setMessage(result.message);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
      onBusy("album", false);
    }
  };
  return (
    <section className="album-import" aria-label="Import a Google Photos album">
      <h3>Add from a Google Photos album</h3>
      <p className="small muted">
        In Google Photos, open the album and choose Share → Create link. Paste
        it here, then choose the photos to keep.
      </p>
      <SharedLinkInput
        label="Google Photos album link"
        type="url"
        placeholder="https://photos.app.goo.gl/…"
        value={url}
        disabled={busy}
        onValue={(value) => {
          setUrl(value.trim());
          setItems([]);
          setMessage("");
        }}
      />
      <button
        type="button"
        className="button"
        disabled={busy || !url.startsWith("https://")}
        onClick={load}
      >
        {busy ? "Loading album…" : "Load album"}
      </button>
      {message && (
        <p className="small" role="status">
          {message}
        </p>
      )}
      {items.length > 0 && (
        <>
          <p>
            {items.length} photo{items.length === 1 ? "" : "s"} found ·{" "}
            {items.length - available.length} already added · {chosen.length}{" "}
            selected
          </p>
          <div className="button-row">
            <button
              type="button"
              className="text-button"
              onClick={() =>
                setSelected(
                  new Set(available.slice(0, remaining).map((p) => p.sourceId)),
                )
              }
            >
              Select all available
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setSelected(new Set())}
            >
              Clear selection
            </button>
          </div>
          <div className="album-selection">
            {items.map((p, i) => {
              const added = existing.has(photoIdentity(p.url));
              return (
                <label key={p.sourceId} className="album-choice">
                  <img
                    src={p.previewUrl}
                    alt={`Album photo ${i + 1}`}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                  <span>
                    <input
                      type="checkbox"
                      disabled={
                        added ||
                        (!selected.has(p.sourceId) &&
                          chosen.length >= remaining)
                      }
                      checked={added || selected.has(p.sourceId)}
                      onChange={(e) =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (e.target.checked) next.add(p.sourceId);
                          else next.delete(p.sourceId);
                          return next;
                        })
                      }
                    />
                    {added
                      ? `Photo ${i + 1} · already added`
                      : `Keep photo ${i + 1}`}
                  </span>
                </label>
              );
            })}
          </div>
          <button
            type="button"
            className="button primary"
            disabled={!chosen.length || chosen.length > remaining}
            onClick={() => {
              onAdd(
                chosen.map(({ sourceId, ...p }) => ({
                  ...p,
                  id: crypto.randomUUID(),
                })),
              );
              setSelected(new Set());
              setMessage(
                "Selected photos added below. Choose a cover, remove any you do not want, then save the visit. Google Photos originals stay unchanged.",
              );
            }}
          >
            Add selected photos ({chosen.length})
          </button>
          <p className="small muted">
            Up to {MAX_VISIT_PHOTOS} photos per visit. This imports the current
            selection; future album changes are not synced.
          </p>
        </>
      )}
    </section>
  );
}

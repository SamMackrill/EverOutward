import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Camera, LoaderCircle, Trash2 } from "lucide-react";
import { request } from "./api";
import {
  directPhoto,
  photoSource,
  photoLinkIssue,
  providerFor,
  providers,
} from "../server/photo-links.mjs";
import type { Photo } from "./types";
import SharedLinkInput from "./SharedLinkInput";
import { photoTakenAt } from "../server/photo-dates.mjs";

export async function preparePhoto(file: File) {
  const previewUrl = await displayPhoto(file);
  const takenAt = await photoTakenAt(await file.arrayBuffer());
  return { previewUrl, takenAt };
}

export async function displayPhoto(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error(
      "Choose a JPEG, PNG or WebP photo. Export HEIC photos as JPEG first.",
    );
  if (file.size > 20 * 1024 * 1024)
    throw new Error("Choose a photo smaller than 20 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.65, 0.45]) {
      const result = canvas.toDataURL("image/jpeg", quality);
      if (result.length <= 750000) return result;
    }
    throw new Error("This preview is too large. Choose a smaller photo.");
  } finally {
    bitmap.close();
  }
}

export function PhotoLibraries() {
  return (
    <div className="photo-library-links" aria-label="Open your photo library">
      {providers.map((p) => (
        <a
          key={p.name}
          className="button quiet"
          href={p.library}
          target="_blank"
          rel="noreferrer"
        >
          {p.name}
          <ArrowUpRight size={13} />
        </a>
      ))}
    </div>
  );
}

export default function VisitPhotoEditor({
  photo,
  index,
  isCover,
  onChange,
  onCover,
  onRemove,
  onBusy,
}: {
  photo: Photo;
  index: number;
  isCover: boolean;
  onChange: (photo: Photo) => void;
  onCover: () => void;
  onRemove: () => void;
  onBusy: (id: string, busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [brokenSource, setBrokenSource] = useState("");
  const latest = useRef(photo);
  latest.current = photo;
  const sequence = useRef(0);
  useEffect(() => {
    onBusy(photo.id, busy);
  }, [photo.id, busy, onBusy]);
  useEffect(
    () => () => {
      sequence.current++;
      onBusy(photo.id, false);
    },
    [photo.id, onBusy],
  );
  const provider = providerFor(photo.url),
    source = photoSource(photo);
  const linkIssue = photoLinkIssue(photo.url);
  const chooseFile = async (file: File) => {
    const job = ++sequence.current;
    setBusy(true);
    try {
      const prepared = await preparePhoto(file);
      if (job !== sequence.current) return;
      onChange({
        ...latest.current,
        ...prepared,
        takenAt: prepared.takenAt || latest.current.takenAt,
      });
      setBrokenSource("");
      setMessage(
        "Display photo ready. Its resized copy is saved with this visit and published when the visit is published.",
      );
    } catch (error) {
      if (job === sequence.current) setMessage((error as Error).message);
    } finally {
      if (job === sequence.current) setBusy(false);
    }
  };
  const resolvePreview = async () => {
    const job = ++sequence.current;
    setBusy(true);
    setMessage("");
    setBrokenSource("");
    try {
      const result = await request<{ previewUrl: string; message: string }>(
        "/api/photo-links/preview",
        { method: "POST", body: JSON.stringify({ url: photo.url }) },
      );
      if (job !== sequence.current) return;
      if (result.previewUrl)
        onChange({ ...latest.current, previewUrl: result.previewUrl });
      setMessage(result.message);
    } catch (e) {
      if (job === sequence.current)
        setMessage(
          (e as Error).message + " You can choose a display photo below.",
        );
    } finally {
      if (job === sequence.current) setBusy(false);
    }
  };
  useEffect(() => {
    if (!photo.url || source || linkIssue || !provider) return;
    const timer = setTimeout(() => void resolvePreview(), 800);
    return () => clearTimeout(timer);
  }, [photo.url, source, linkIssue]);
  return (
    <div
      className="photo-editor"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          e.stopPropagation();
          void chooseFile(e.dataTransfer.files[0]);
        }
      }}
    >
      <div className="form-grid">
        <SharedLinkInput
          label={`Photo ${index + 1} link`}
          type="url"
          value={photo.url}
          required={!photo.previewUrl}
          pattern="https://.*"
          placeholder="Paste a shared photo or album link"
          onValue={(value) => {
            sequence.current++;
            setBusy(false);
            setMessage("");
            setBrokenSource("");
            const url = value.trim();
            const direct = directPhoto(url);
            onChange({
              ...photo,
              url,
              takenAt: url === photo.url ? photo.takenAt : undefined,
              kind:
                photo.kind === "album"
                  ? "album"
                  : providerFor(url) || !direct
                    ? "shared"
                    : "image",
              previewUrl: direct,
            });
          }}
        />
        <label>
          Link type
          <select
            value={photo.kind}
            onChange={(e) =>
              onChange({ ...photo, kind: e.target.value as Photo["kind"] })
            }
          >
            <option value="shared">Shared photo / collection</option>
            <option value="album">Album page</option>
            <option value="image">Direct photo</option>
          </select>
        </label>
      </div>
      {linkIssue && !source && (
        <p className="photo-link-issue" role="status">
          {linkIssue}
        </p>
      )}
      {provider && !linkIssue && (
        <p className="small muted">
          <strong>{provider.name}:</strong> {provider.help}
        </p>
      )}
      <div className="button-row">
        <button
          className="button quiet"
          type="button"
          disabled={busy || !!linkIssue || !photo.url.startsWith("https://")}
          onClick={resolvePreview}
        >
          {busy ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <Camera size={16} />
          )}
          Load preview
        </button>
        {photo.url.startsWith("https://") && (
          <a
            className="text-button"
            href={photo.url}
            target="_blank"
            rel="noreferrer"
          >
            Open original link
            <ArrowUpRight size={14} />
          </a>
        )}
      </div>
      {message && (
        <p className="small" role="status">
          {message}
        </p>
      )}
      {source && source !== brokenSource && (
        <img
          className="photo-link-preview"
          src={source}
          alt={photo.caption || `Photo ${index + 1} preview`}
          referrerPolicy="no-referrer"
          onError={() => setBrokenSource(source)}
        />
      )}
      {source && source === brokenSource && (
        <p className="small" role="status">
          This image could not be displayed. Choose a display photo or update
          the preview link.
        </p>
      )}
      <label>
        Choose a display photo{" "}
        <span className="optional">optional · for previews and covers</span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            void chooseFile(file);
            e.target.value = "";
          }}
        />
      </label>
      <details className="photo-preview-options">
        <summary>Use an existing image URL instead</summary>
        <label>
          Display image URL
          <input
            type="url"
            placeholder="https://…/photo.jpg"
            value={
              photo.previewUrl?.startsWith("data:")
                ? ""
                : photo.previewUrl || ""
            }
            pattern="https://.*"
            onChange={(e) => {
              sequence.current++;
              setBusy(false);
              setBrokenSource("");
              onChange({ ...photo, previewUrl: e.target.value.trim() });
            }}
          />
        </label>
      </details>
      <label>
        Photo taken at
        <input
          type="datetime-local"
          aria-label="Photo taken at"
          step="any"
          value={
            photo.takenAt
              ?.replace(/(Z|[+-]\d{2}:\d{2})$/, "")
              .replace(/(\.\d{3})\d+$/, "$1") || ""
          }
          onChange={(e) => {
            const value = e.target.value;
            const timezone =
              photo.takenAt?.match(/(Z|[+-]\d{2}:\d{2})$/)?.[0] || "";
            onChange({
              ...photo,
              takenAt: value
                ? (value.length === 16 ? value + ":00" : value) + timezone
                : undefined,
            });
          }}
        />
        <span className="small muted">
          Set or correct the time to place this photo in the visit sequence.{" "}
          {photo.takenAt?.match(/(Z|[+-]\d{2}:\d{2})$/)?.[0]
            ? `Recorded time zone: ${photo.takenAt.endsWith("Z") ? "UTC" : photo.takenAt.slice(-6)}.`
            : "Camera time; time zone not recorded."}
        </span>
      </label>
      <label>
        Caption / image description
        <input
          value={photo.caption}
          maxLength={300}
          onChange={(e) => onChange({ ...photo, caption: e.target.value })}
        />
      </label>
      <div className="button-row">
        <label className="checkbox">
          <input
            type="radio"
            name="cover"
            checked={isCover}
            disabled={!source || source === brokenSource || busy}
            onChange={onCover}
          />
          Visit cover
        </label>
        <button className="text-button danger" type="button" onClick={onRemove}>
          <Trash2 size={15} />
          Remove
        </button>
      </div>
      {isCover && (
        <p className="small muted">
          The timeline uses this cover. The visit carousel follows the photo
          sequence.
        </p>
      )}
      {!source && (
        <p className="small muted">
          Load a preview or choose a display photo to use this link as the
          cover.
        </p>
      )}
    </div>
  );
}

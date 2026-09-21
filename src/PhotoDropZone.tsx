import { useState } from "react";
import { ImagePlus } from "lucide-react";
import { displayPhoto } from "./VisitPhotoEditor";
import { directPhoto, providerFor } from "../server/photo-links.mjs";
import type { Photo } from "./types";

export default function PhotoDropZone({
  remaining,
  onAdd,
  onBusy,
}: {
  remaining: number;
  onAdd: (photos: Photo[]) => void;
  onBusy: (id: string, busy: boolean) => void;
}) {
  const [dragging, setDragging] = useState(false),
    [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  const addFiles = async (files: File[]) => {
    if (working) return;
    setWorking(true);
    onBusy("drop", true);
    const added: Photo[] = [],
      errors: string[] = [];
    try {
      for (const file of files.slice(0, remaining)) {
        try {
          added.push({
            id: crypto.randomUUID(),
            url: "",
            kind: "image",
            caption: "",
            previewUrl: await displayPhoto(file),
          });
        } catch (error) {
          errors.push(`${file.name}: ${(error as Error).message}`);
        }
      }
      onAdd(added);
      setMessage(
        [
          `${added.length} photo${added.length === 1 ? "" : "s"} added.`,
          files.length > remaining
            ? "Each visit can hold up to 200 photos or collections."
            : "",
          ...errors,
        ]
          .filter(Boolean)
          .join(" "),
      );
    } finally {
      setWorking(false);
      onBusy("drop", false);
    }
  };
  return (
    <div
      className={`photo-drop-zone ${dragging ? "dragging" : ""}`}
      role="group"
      aria-label="Add photos or shared links"
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragging(false);
        if (working || remaining === 0) {
          setMessage(
            working
              ? "Wait for the current photos to finish."
              : "Each visit can hold up to 200 photos or collections.",
          );
          return;
        }
        if (e.dataTransfer.files.length) {
          void addFiles([...e.dataTransfer.files]);
          return;
        }
        const text =
          e.dataTransfer.getData("text/uri-list") ||
          e.dataTransfer.getData("text/plain");
        const links = [
          ...new Set(
            text.split(/\s+/).filter((line) => line.startsWith("https://")),
          ),
        ];
        const added: Photo[] = [];
        for (const value of links.slice(0, remaining)) {
          try {
            const parsed = new URL(value);
            if (parsed.username || parsed.password) continue;
            const direct = directPhoto(parsed.href);
            added.push({
              id: crypto.randomUUID(),
              url: parsed.href,
              kind: providerFor(parsed.href) || !direct ? "shared" : "image",
              caption: "",
              previewUrl: direct,
            });
          } catch {}
        }
        onAdd(added);
        setMessage(
          added.length
            ? `${added.length} link${added.length === 1 ? "" : "s"} added. Load a preview below.`
            : "Drop a shared HTTPS link or a JPEG, PNG or WebP image.",
        );
      }}
    >
      <ImagePlus size={24} />
      <strong>
        {working
          ? "Preparing your photos…"
          : "Drop photos or shared links here"}
      </strong>
      <span className="small muted">
        JPEG, PNG or WebP · up to 200 photos or collections per visit
      </span>
      <label className="button quiet">
        Choose photos from your device
        <input
          className="visually-hidden"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          disabled={working || remaining === 0}
          onChange={(e) => {
            if (e.target.files) void addFiles([...e.target.files]);
            e.target.value = "";
          }}
        />
      </label>
      <span className="small muted">
        Resized display copies are saved with the visit. You can also drop an
        image onto an existing link below.
      </span>
      {message && (
        <p className="small" role="status">
          {message}
        </p>
      )}
    </div>
  );
}

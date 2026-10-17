/** Capture times keep the camera's clock when no UTC offset was recorded. */
export function validTakenAt(value) {
  if (typeof value !== "string") return false;
  const match = value.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})?$/,
  );
  if (
    !match ||
    match[1].startsWith("0000") ||
    +match[2] > 23 ||
    +match[3] > 59 ||
    +match[4] > 59
  )
    return false;
  const date = new Date(`${match[1]}T00:00:00Z`);
  if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== match[1])
    return false;
  if (match[6] && match[6] !== "Z") {
    const [hours, minutes] = match[6].slice(1).split(":").map(Number);
    if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0))
      return false;
  }
  return Number.isFinite(Date.parse(value + (match[6] ? "" : "Z")));
}

/** @template {{ takenAt?: string }} T
 * @param {T[]} photos
 * @returns {T[]}
 */
export function sortPhotos(photos = []) {
  const time = (photo) =>
    validTakenAt(photo.takenAt)
      ? Math.floor(
          Date.parse(
            photo.takenAt +
              (/(Z|[+-]\d{2}:\d{2})$/.test(photo.takenAt) ? "" : "Z"),
          ) / 1000,
        )
      : Infinity;
  // Stable sort retains the saved order for equal or unknown capture times.
  return [...photos].sort((a, b) => {
    const first = time(a),
      second = time(b);
    if (first !== second) return first - second;
    if (first === Infinity) return 0;
    const fraction = (photo) =>
      (photo.takenAt.match(/\.(\d+)/)?.[1] || "").padEnd(9, "0");
    return fraction(a).localeCompare(fraction(b));
  });
}

/** Read only capture-time tags, before creating the metadata-free display copy. */
export async function photoTakenAt(input) {
  try {
    let bytes = new Uint8Array(input);
    // exifr reads TIFF/JPEG/PNG. A WebP EXIF chunk contains the same TIFF data.
    if (
      String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
    ) {
      const view = new DataView(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      );
      for (let pos = 12; pos + 8 <= bytes.length;) {
        const size = view.getUint32(pos + 4, true);
        if (pos + 8 + size > bytes.length) return undefined;
        if (String.fromCharCode(...bytes.slice(pos, pos + 4)) === "EXIF") {
          bytes = bytes.slice(pos + 8, pos + 8 + size);
          if (String.fromCharCode(...bytes.slice(0, 6)) === "Exif\0\0")
            bytes = bytes.slice(6);
          break;
        }
        pos += 8 + size + (size % 2);
      }
    }
    const { default: exifr } = await import("exifr");
    const tags = await exifr.parse(bytes, {
      pick: ["DateTimeOriginal", "OffsetTimeOriginal", "SubSecTimeOriginal"],
      reviveValues: false,
    });
    const original = tags?.DateTimeOriginal;
    if (typeof original !== "string") return undefined;
    const base = original
      .trim()
      .replace(/^(\d{4}):(\d{2}):(\d{2}) /, "$1-$2-$3T");
    const fraction = /^\d{1,9}$/.test(tags.SubSecTimeOriginal || "")
      ? `.${tags.SubSecTimeOriginal}`
      : "";
    const offset = /^[+-]\d{2}:\d{2}$/.test(tags.OffsetTimeOriginal || "")
      ? tags.OffsetTimeOriginal
      : "";
    const result = base + fraction + offset;
    return validTakenAt(result) ? result : undefined;
  } catch {
    // Missing or malformed EXIF must never prevent adding a display photo.
    return undefined;
  }
}

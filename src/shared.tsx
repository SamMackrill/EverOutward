import { useEffect, useState } from "react";
import { Camera, Star } from "lucide-react";
import {
  photoSource,
  providerFor,
  photoLinkIssue,
} from "../server/photo-links.mjs";
import { duration, miles } from "./format";
import type { Photo, Place, Route } from "./types";

export function WalkingEstimate({
  route,
  detail = false,
}: {
  route?: Route;
  detail?: boolean;
}) {
  if (!route?.walkingMetres || !route.walkingSeconds) return null;
  return (
    <p className="small walking-estimate">
      + approx. {miles(route.walkingMetres)} mi walk ·{" "}
      {duration(route.walkingSeconds)} one way
      {detail && (
        <>
          <br />
          Approx. {miles(route.metres + route.walkingMetres)} mi and{" "}
          {duration(route.seconds + route.walkingSeconds)} including the drive.
          <br />
          <span className="muted">{route.walkingNote}</span>
        </>
      )}
    </p>
  );
}
export function Stars({ value }: { value: number | null }) {
  return value ? (
    <span className="stars" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star size={13} key={i} fill={i <= value ? "currentColor" : "none"} />
      ))}
    </span>
  ) : null;
}
export function EmptyPhoto({ small = false }: { small?: boolean }) {
  return (
    <div className={`empty-photo ${small ? "small" : ""}`}>
      <Camera size={small ? 22 : 32} />
      <span>No visit photo yet</span>
    </div>
  );
}
export function PhotoImage({
  photo,
  className = "",
}: {
  photo: Photo;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const source = photoSource(photo);
  useEffect(() => setFailed(false), [source]);
  return failed || !source ? (
    <div className="empty-photo">
      <Camera />
      <span>{providerFor(photo.url)?.name || "Photo collection"}</span>
      <small>
        {failed
          ? "Preview unavailable · open original link"
          : photoLinkIssue(photo.url)
            ? "Google sharing link needed"
            : "Open the linked photos"}
      </small>
    </div>
  ) : (
    <img
      className={className}
      src={source}
      alt={photo.caption || "Photo from our visit"}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

export function PhotoCredit({ place }: { place: Place }) {
  return place.imageSource ? (
    <p className="photo-credit">
      Photo:{" "}
      <a href={place.imageSource} target="_blank" rel="noreferrer">
        {place.imageAuthor}
      </a>{" "}
      ·{" "}
      <a href={place.imageLicenceUrl} target="_blank" rel="noreferrer">
        {place.imageLicence}
      </a>
    </p>
  ) : null;
}

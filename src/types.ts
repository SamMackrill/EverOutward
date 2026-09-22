export type Place = {
  id: string;
  name: string;
  region: string;
  lat: number;
  lng: number;
  description: string;
  officialUrl: string;
  image: string;
  imageAuthor?: string;
  imageSource?: string;
  imageLicence?: string;
  imageLicenceUrl?: string;
  imageAlt?: string;
  hours: string;
  entranceVerified: boolean;
};
export type Photo = {
  id: string;
  url: string;
  caption: string;
  kind: "image" | "album" | "shared";
  previewUrl?: string;
};
export type Visit = {
  publicationStatus?: string;
  startingHomeId?: string;
  startingHomeVersion?: string;
  startingHomeSnapshot?: {
    label: string;
    colour: string;
    lat: number;
    lng: number;
  };
  startingHomeLabel?: string | null;
  id: string;
  placeId: string;
  date: string;
  title: string;
  summary: string;
  notes: string;
  attendees: string[];
  rating: number | null;
  photos: Photo[];
  coverId: string | null;
  published: boolean;
  createdAt: string;
  updatedAt: string;
};
export type Home = {
  id: string;
  label: string;
  colour: string;
  lat: number;
  lng: number;
  version: string;
  archivedAt?: string | null;
};
export type HomeJourney = {
  id: string;
  label: string;
  colour: string;
  range: VisitRange;
  queue: { placeId: string; metres: number; seconds: number }[];
  complete: boolean;
  pendingCount: number;
  saved?: number;
  total?: number;
  unavailablePlaces?: { placeId: string; name: string; reason: string }[];
};
export type VisitRange = {
  confirmed?: boolean;
  centre: { lat: number; lng: number };
  radius: number;
  approximate: boolean;
};
export type Route = {
  homeId?: string;
  placeId: string;
  metres: number;
  seconds: number;
  homeVersion: string;
  checkedAt: string;
  source: string;
};
export type Comment = {
  id: string;
  visitId: string;
  photoId: string | null;
  name: string;
  body: string;
  createdAt: string;
};
export type Session = {
  localOwner?: boolean;
  local: boolean;
  owner: boolean;
  passwordConfigured: boolean;
};

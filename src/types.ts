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
export type Home = { label: string; lat: number; lng: number; version: string };
export type VisitRange = {
  centre: { lat: number; lng: number };
  radius: number;
  approximate: boolean;
};
export type Route = {
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
  local: boolean;
  owner: boolean;
  passwordConfigured: boolean;
};

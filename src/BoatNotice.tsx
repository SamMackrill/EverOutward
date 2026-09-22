import { Ship } from "lucide-react";
import type { Place } from "./types";

export default function BoatNotice({ place }: { place?: Place }) {
  return place?.boatRequired ? (
    <p className="boat-notice">
      <Ship size={16} aria-hidden="true" />
      Boat trip required
    </p>
  ) : null;
}

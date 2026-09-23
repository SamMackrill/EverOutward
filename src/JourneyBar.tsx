import { ChevronRight, Plus } from "lucide-react";
import { miles } from "./format";
import type { Place, VisitRange } from "./types";

/** The journey at a glance: places visited, days out and the current range. */
export function ProgressStrip({
  visited,
  total,
  days,
  range,
}: {
  visited: number;
  total: number;
  days: number;
  range: VisitRange | null;
}) {
  return (
    <div className="progress-strip">
      <p>
        <strong>{visited}</strong> of {total} places · <strong>{days}</strong>{" "}
        {days === 1 ? "day" : "days"} out
        {range && range.radius > 0 && (
          <>
            {" "}
            · range{" "}
            <strong>
              {range.approximate ? "≈" : ""}
              {miles(range.radius)} mi
            </strong>
          </>
        )}
      </p>
      <div
        className="progress-bar"
        role="progressbar"
        aria-label="Places visited"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={visited}
      >
        <span
          style={{ width: total ? `${(visited / total) * 100}%` : 0 }}
          className={visited ? "started" : ""}
        />
      </div>
    </div>
  );
}

/**
 * The strip under the site header. The map view gets the next gate as its
 * title; other views get a slim bar with a link to the next gate.
 */
export default function JourneyBar({
  title,
  nextGate,
  progress,
  owner,
  onRecord,
  onNextGate,
}: {
  // Only the map view has a hero title; other views title their own content.
  title?: string;
  nextGate?: Place;
  progress: Parameters<typeof ProgressStrip>[0];
  owner: boolean;
  onRecord: () => void;
  onNextGate: () => void;
}) {
  return (
    <div className={`journey-bar ${title ? "" : "journey-bar-slim"}`}>
      {title && (
        <div className="journey-title">
          <span className="eyebrow">
            Your next gate · nearest unvisited by road
          </span>
          <h1>{title}</h1>
        </div>
      )}
      <ProgressStrip {...progress} />
      <div className="journey-meta">
        {!title && nextGate && (
          <button className="next-gate-chip" onClick={onNextGate}>
            <span className="eyebrow">Next gate</span>
            <span>{nextGate.name}</span>
            <ChevronRight size={15} />
          </button>
        )}
        {owner && (
          <button className="button primary" onClick={onRecord}>
            <Plus size={18} />
            Record a visit
          </button>
        )}
      </div>
    </div>
  );
}

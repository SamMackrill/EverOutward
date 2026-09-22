import { useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import Modal from "./Modal";
import { wazeLink } from "../server/domain.mjs";
import type { Place } from "./types";

/** Collects and saves a place's driving distance and duration. */
export default function RouteEditor({
  place,
  onClose,
  onSave,
}: {
  place: Place;
  onClose: () => void;
  onSave: (metres: number, seconds: number) => Promise<void>;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  return (
    <Modal
      title={`Driving to ${place.name}`}
      onClose={onClose}
      isDirty={() =>
        [...new FormData(form.current!).values()].some((v) => v !== "")
      }
    >
      <form
        ref={form}
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          setBusy(true);
          try {
            await onSave(
              Number(d.get("miles")) * 1609.344,
              Number(d.get("minutes")) * 60,
            );
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          Check the journey from your saved home in Waze, then record its road
          distance and estimated travel time here.
        </p>
        <a
          className="text-button"
          href={wazeLink(place)}
          target="_blank"
          rel="noreferrer"
        >
          Open destination in Waze <ArrowUpRight size={16} />
        </a>
        <div className="form-grid">
          <label>
            Driving distance (miles)
            <input name="miles" type="number" min="0" step="0.1" required />
          </label>
          <label>
            Travel time (minutes)
            <input name="minutes" type="number" min="0" step="1" required />
          </label>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          Save route
        </button>
      </form>
    </Modal>
  );
}

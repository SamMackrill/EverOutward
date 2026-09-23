import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { Star, X } from "lucide-react";
import type { Place } from "./types";

const MAX_OPTIONS = 50;

/**
 * A searchable place combobox. With no search text it offers the next five
 * and recently visited places before the full list.
 */
export function PlacePicker({
  places,
  value,
  onChange,
  next = [],
  recent = [],
}: {
  places: Place[];
  value: string;
  onChange: (id: string) => void;
  next?: Place[];
  recent?: Place[];
}) {
  const id = useId();
  const selected = places.find((p) => p.id === value);
  const [text, setText] = useState(selected?.name || ""),
    [open, setOpen] = useState(false),
    [active, setActive] = useState(0);
  const searching = !!text.trim() && text !== selected?.name;
  const groups = useMemo(() => {
    if (!open) return [];
    if (searching) {
      const q = text.trim().toLowerCase();
      const matches = places
        .filter((p) => `${p.name} ${p.region}`.toLowerCase().includes(q))
        .sort(
          (a, b) =>
            Number(!a.name.toLowerCase().startsWith(q)) -
              Number(!b.name.toLowerCase().startsWith(q)) ||
            a.name.localeCompare(b.name),
        );
      return [{ label: `${matches.length} matching places`, places: matches }];
    }
    const nextIds = new Set(next.map((p) => p.id));
    const recentOnly = recent.filter((p) => !nextIds.has(p.id));
    return [
      { label: "Your next five", places: next },
      { label: "Recently visited", places: recentOnly },
      {
        label: "All places",
        places: [...places].sort((a, b) => a.name.localeCompare(b.name)),
      },
    ].filter((g) => g.places.length);
  }, [open, searching, text, places, next, recent]);
  // Keyboard order runs through the groups; long lists are trimmed.
  const options: Place[] = [];
  const shown = groups.map((g) => {
    const room = Math.max(0, MAX_OPTIONS - options.length);
    const list = g.places.slice(0, room);
    options.push(...list);
    return { ...g, list };
  });
  const choose = (place: Place) => {
    onChange(place.id);
    setText(place.name);
    setOpen(false);
  };
  const keyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return setOpen(true);
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + options.length) % options.length);
    } else if (e.key === "Enter" && open && options[active]) {
      e.preventDefault();
      choose(options[active]);
    } else if (e.key === "Escape" && open) {
      // Close the list without closing the dialog around it.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  };
  let index = -1;
  return (
    <div className="place-picker">
      <label htmlFor={`${id}-input`}>National Trust place</label>
      <input
        id={`${id}-input`}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={
          open && options[active] ? `${id}-${options[active].id}` : undefined
        }
        autoComplete="off"
        placeholder={`Search ${places.length} places`}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          if (!text.trim()) onChange("");
          else setText(selected?.name || "");
        }}
        onKeyDown={keyDown}
      />
      <input type="hidden" name="placeId" value={value} />
      {open && (
        <ul className="place-options" id={`${id}-list`} role="listbox">
          {shown.map((g) => (
            <li key={g.label} role="presentation">
              <span className="place-group" role="presentation">
                {g.label}
              </span>
              <ul role="presentation">
                {g.list.map((p) => {
                  index++;
                  const i = index;
                  return (
                    <li
                      key={p.id}
                      id={`${id}-${p.id}`}
                      role="option"
                      aria-selected={p.id === value}
                      className={i === active ? "active" : ""}
                      // Keep focus in the input so blur doesn't close first.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => choose(p)}
                      onMouseEnter={() => setActive(i)}
                    >
                      {p.name}
                      <small>{p.region}</small>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
          {!options.length && (
            <li className="place-group" role="presentation">
              No places match “{text}”
            </li>
          )}
          {options.length >= MAX_OPTIONS && (
            <li className="place-group" role="presentation">
              Type to narrow the list
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/** Five clickable stars backed by radio buttons, so arrow keys work too. */
export function StarRating({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <fieldset className="star-rating">
      <legend>Your rating</legend>
      <div>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} title={`${n} out of 5`}>
            <input
              className="visually-hidden"
              type="radio"
              name="rating"
              value={n}
              checked={value === n}
              onChange={() => onChange(n)}
            />
            <Star
              size={24}
              aria-hidden="true"
              fill={value && n <= value ? "currentColor" : "none"}
            />
            <span className="visually-hidden">
              {n} {n === 1 ? "star" : "stars"}
            </span>
          </label>
        ))}
        {value ? (
          <button
            type="button"
            className="text-button"
            onClick={() => onChange(null)}
          >
            Clear rating
          </button>
        ) : (
          <span className="small muted">Not rated</span>
        )}
      </div>
    </fieldset>
  );
}

/** Names as removable chips, suggesting people from earlier visits. */
export function PeopleInput({
  value,
  onChange,
  suggestions,
}: {
  value: string[];
  onChange: (names: string[]) => void;
  suggestions: string[];
}) {
  const id = useId();
  const [text, setText] = useState("");
  const add = (names: string[]) => {
    const fresh = names
      .map((n) => n.trim())
      .filter((n) => n && !value.includes(n));
    if (fresh.length) onChange([...value, ...new Set(fresh)]);
  };
  return (
    <div className="people-field">
      <label htmlFor={`${id}-input`}>
        Who came along? <span className="optional">optional</span>
      </label>
      <div className="people-input">
        {value.map((name) => (
          <span className="chip-token" key={name}>
            {name}
            <button
              type="button"
              aria-label={`Remove ${name}`}
              onClick={() => onChange(value.filter((n) => n !== name))}
            >
              <X size={13} />
            </button>
          </span>
        ))}
        <input
          id={`${id}-input`}
          name="attendeeDraft"
          list={`${id}-people`}
          autoComplete="off"
          placeholder={value.length ? "Add someone" : "Ana, Sam, Ele"}
          value={text}
          onChange={(e) => {
            // Commas (typed or pasted) finish a name.
            const parts = e.target.value.split(/[,\n]/);
            if (parts.length > 1) add(parts.slice(0, -1));
            setText(parts.at(-1) || "");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && text.trim()) {
              e.preventDefault();
              add([text]);
              setText("");
            } else if (e.key === "Backspace" && !text && value.length)
              onChange(value.slice(0, -1));
          }}
          onBlur={() => {
            add([text]);
            setText("");
          }}
        />
        <datalist id={`${id}-people`}>
          {suggestions
            .filter((n) => !value.includes(n))
            .map((n) => (
              <option key={n} value={n} />
            ))}
        </datalist>
      </div>
      <input type="hidden" name="attendees" value={value.join(", ")} />
    </div>
  );
}

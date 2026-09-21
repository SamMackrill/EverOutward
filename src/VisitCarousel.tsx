import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { photoSource } from "../server/photo-links.mjs";
import type { Photo } from "./types";

const intervalKey = "eo-carousel-seconds";
function validInterval(value: string | null) {
  const seconds = Number(value);
  return Number.isInteger(seconds) && seconds >= 1 && seconds <= 20
    ? seconds
    : 10;
}
let sessionInterval = 10;
function savedInterval() {
  try {
    return validInterval(localStorage.getItem(intervalKey));
  } catch {
    return sessionInterval;
  }
}

export default function VisitCarousel({
  photos,
  coverId,
  suspended,
  onOpen,
}: {
  photos: Photo[];
  coverId: string | null;
  suspended: boolean;
  onOpen: (photo: Photo) => void;
}) {
  const [currentId, setCurrentId] = useState(coverId);
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [playing, setPlaying] = useState(
    () => !matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [visible, setVisible] = useState(() => !document.hidden);
  const [seconds, setSeconds] = useState(savedInterval);
  const [drag, setDrag] = useState(0);
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const dragged = useRef(false);
  const wheelTime = useRef(-Infinity);
  const wheelDelta = useRef(0);
  const wheelLastInput = useRef(0);
  const wheel = useRef<HTMLDivElement>(null);
  const available = useMemo(
    () => photos.filter((p) => photoSource(p) && !failed.has(photoSource(p))),
    [photos, failed],
  );
  const count = available.length;
  const index = Math.max(
    0,
    available.findIndex((p) => p.id === currentId),
  );
  const current = available[index];
  const rotating = playing && visible && !suspended && count > 1;
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === intervalKey || event.key === null)
        setSeconds(validInterval(event.newValue));
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  useEffect(() => {
    const changed = () => setVisible(!document.hidden);
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const motionChanged = () => {
      if (media.matches) setPlaying(false);
    };
    document.addEventListener("visibilitychange", changed);
    media.addEventListener("change", motionChanged);
    return () => {
      document.removeEventListener("visibilitychange", changed);
      media.removeEventListener("change", motionChanged);
    };
  }, []);
  useEffect(() => {
    if (!rotating) return;
    const timer = setTimeout(
      () => setCurrentId(available[(index + 1) % count].id),
      seconds * 1000,
    );
    return () => clearTimeout(timer);
  }, [rotating, available, count, index, seconds]);
  useEffect(() => {
    const element = wheel.current;
    if (!element || count < 2) return;
    const scroll = (e: WheelEvent) => {
      const delta = e.shiftKey
        ? e.deltaY || e.deltaX
        : Math.abs(e.deltaX) > Math.abs(e.deltaY)
          ? e.deltaX
          : 0;
      if (!delta) return;
      e.preventDefault();
      const now = performance.now();
      if (now - wheelTime.current < 650) return;
      if (now - wheelLastInput.current > 300) wheelDelta.current = 0;
      wheelLastInput.current = now;
      wheelDelta.current += delta;
      if (Math.abs(wheelDelta.current) < 20) return;
      wheelTime.current = now;
      setPlaying(false);
      setCurrentId(
        available[(index + (wheelDelta.current > 0 ? 1 : -1) + count) % count]
          .id,
      );
      wheelDelta.current = 0;
    };
    element.addEventListener("wheel", scroll, { passive: false });
    return () => element.removeEventListener("wheel", scroll);
  }, [available, count, index]);
  if (!current) return null;
  const move = (direction: number) =>
    setCurrentId(available[(index + direction + count) % count].id);
  const imageFailed = (p: Photo) =>
    setFailed((previous) => new Set(previous).add(photoSource(p)));
  return (
    <section
      className="visit-carousel"
      role="region"
      aria-roledescription="carousel"
      aria-label="Photos from this visit"
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).closest("select, input, textarea"))
          return;
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          setPlaying(false);
          move(e.key === "ArrowLeft" ? -1 : 1);
        }
      }}
    >
      <div
        ref={wheel}
        className={`carousel-wheel ${drag ? "is-dragging" : ""}`}
        style={{ "--drag": `${drag}px` } as CSSProperties}
        onPointerDown={(e) => {
          if (count < 2 || e.button !== 0) return;
          pointer.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
          dragged.current = false;
        }}
        onPointerMove={(e) => {
          const start = pointer.current;
          if (!start || start.id !== e.pointerId) return;
          const dx = e.clientX - start.x,
            dy = e.clientY - start.y;
          if (
            !dragged.current &&
            Math.abs(dy) > Math.abs(dx) &&
            Math.abs(dy) > 10
          ) {
            pointer.current = null;
            return;
          }
          if (Math.abs(dx) > 8) {
            dragged.current = true;
            setPlaying(false);
            e.currentTarget.setPointerCapture(e.pointerId);
            setDrag(Math.max(-180, Math.min(180, dx)));
          }
        }}
        onPointerUp={(e) => {
          const start = pointer.current;
          if (!start || start.id !== e.pointerId) return;
          const dx = e.clientX - start.x;
          if (dragged.current && Math.abs(dx) >= 40) move(dx < 0 ? 1 : -1);
          pointer.current = null;
          setDrag(0);
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          pointer.current = null;
          setDrag(0);
        }}
        onDragStart={(e) => e.preventDefault()}
        onClickCapture={(e) => {
          if (dragged.current) {
            e.preventDefault();
            e.stopPropagation();
            dragged.current = false;
          }
        }}
      >
        {available.map((p, i) => {
          let offset = (i - index + count) % count;
          if (offset > count / 2) offset -= count;
          if (Math.abs(offset) > 2) return null;
          const active = offset === 0;
          const style = {
            "--offset": offset,
            "--depth": Math.abs(offset),
            zIndex: 3 - Math.abs(offset),
          } as CSSProperties;
          return (
            <div
              key={p.id}
              className={`carousel-slide ${active ? "is-active" : ""}`}
              style={style}
              aria-hidden={!active}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${count}`}
            >
              <button
                type="button"
                tabIndex={active ? 0 : -1}
                disabled={!active}
                aria-label={`Open photo: ${p.caption || `Photo ${i + 1}`}`}
                onClick={() => {
                  setPlaying(false);
                  onOpen(p);
                }}
              >
                <img
                  src={photoSource(p)}
                  alt={
                    active ? p.caption || `Photo ${i + 1} from this visit` : ""
                  }
                  draggable={false}
                  referrerPolicy="no-referrer"
                  onError={() => imageFailed(p)}
                />
              </button>
            </div>
          );
        })}
        {count === 2 && (
          <div
            className="carousel-slide carousel-two-back"
            style={{ "--offset": -1, "--depth": 1 } as CSSProperties}
            aria-hidden="true"
          >
            <img
              src={photoSource(available[(index + 1) % count])}
              alt=""
              draggable={false}
              referrerPolicy="no-referrer"
            />
          </div>
        )}
      </div>
      <div className="carousel-toolbar">
        <div className="carousel-controls">
          <button
            type="button"
            className="icon-button"
            aria-label="Previous photo"
            disabled={count < 2}
            onClick={() => move(-1)}
          >
            <ChevronLeft size={20} />
          </button>
          <button
            type="button"
            className="button quiet"
            disabled={count < 2}
            onClick={() => setPlaying(!playing)}
            aria-label={
              playing && count > 1 ? "Pause slideshow" : "Play slideshow"
            }
          >
            {playing && count > 1 ? <Pause size={16} /> : <Play size={16} />}
            {playing && count > 1 ? "Pause" : "Play"}
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Next photo"
            disabled={count < 2}
            onClick={() => move(1)}
          >
            <ChevronRight size={20} />
          </button>
        </div>
        <label
          className="carousel-interval"
          title="Time between photos. Remembered in this browser."
        >
          Every
          <select
            aria-label="Slideshow interval"
            value={seconds}
            onChange={(e) => {
              const value = validInterval(e.target.value);
              setSeconds(value);
              sessionInterval = value;
              try {
                localStorage.setItem(intervalKey, String(value));
              } catch {
                /* Keep the choice for this session when storage is unavailable. */
              }
            }}
          >
            {Array.from({ length: 20 }, (_, i) => i + 1).map((value) => (
              <option key={value} value={value}>
                {value}s
              </option>
            ))}
          </select>
        </label>
        <p className="carousel-counter" aria-live={rotating ? "off" : "polite"}>
          {index + 1} / {count}
          <span>
            {count > 1
              ? playing
                ? `A new photo every ${seconds} second${seconds === 1 ? "" : "s"}`
                : "Slideshow paused"
              : "One photo from this visit"}
          </span>
        </p>
      </div>
      {current.caption && <p className="carousel-caption">{current.caption}</p>}
    </section>
  );
}

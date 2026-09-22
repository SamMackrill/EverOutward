import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Renders a modal dialog and optionally guards every close path against
 * discarding unsaved edits.
 */
export default function Modal({
  title,
  children,
  onClose,
  isDirty,
  wide = false,
  closeLabel = "Close dialog",
}: {
  title: string;
  children: ReactNode | ((requestClose: () => void) => ReactNode);
  onClose: () => void;
  isDirty?: () => boolean;
  wide?: boolean;
  closeLabel?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    keep = useRef<HTMLButtonElement>(null),
    unmounting = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => {
      unmounting.current = true;
      d?.close();
    };
  }, []);
  useEffect(() => {
    if (confirming) keep.current?.focus();
  }, [confirming]);
  /** Closes a clean dialog or asks the user to discard unsaved changes. */
  const requestClose = () => {
    if (isDirty?.()) setConfirming(true);
    else onClose();
  };
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={(e) => {
        if (!isDirty) return onClose();
        e.preventDefault();
        if (confirming) setConfirming(false);
        else requestClose();
      }}
      onClose={() => {
        // Browsers may refuse to cancel a repeated Esc; reopen rather than
        // leave a closed dialog holding unsaved work.
        if (unmounting.current || !isDirty) return;
        if (isDirty()) {
          ref.current?.showModal();
          setConfirming(true);
        } else onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button
          type="button"
          aria-label={closeLabel}
          className="icon-button"
          onClick={requestClose}
        >
          <X />
        </button>
      </header>
      {typeof children === "function" ? children(requestClose) : children}
      {confirming && (
        <div
          className="discard-confirm"
          role="alertdialog"
          aria-labelledby={`${id}-discard`}
        >
          <p id={`${id}-discard`}>
            <strong>Discard your changes?</strong> Your edits haven’t been
            saved.
          </p>
          <div className="button-row">
            <button
              type="button"
              className="button"
              ref={keep}
              onClick={() => setConfirming(false)}
            >
              Keep editing
            </button>
            <button
              type="button"
              className="button danger-fill"
              onClick={onClose}
            >
              Discard changes
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}

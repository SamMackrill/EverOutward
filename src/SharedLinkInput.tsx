import { useRef, useState } from "react";
import type { InputHTMLAttributes } from "react";
import { ClipboardPaste } from "lucide-react";

export default function SharedLinkInput({
  label,
  value,
  onValue,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> & {
  label: string;
  value: string;
  onValue: (value: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const paste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) throw new Error("empty");
      onValue(text);
      setMessage("Link pasted.");
    } catch {
      input.current?.focus();
      input.current?.select();
      setMessage(
        "Your browser could not read the clipboard. The link field is selected: press Ctrl+V (⌘V on Mac), or long-press and choose Paste.",
      );
    }
  };
  return (
    <div className="shared-link-field">
      <label>
        {label}
        <input
          {...props}
          ref={input}
          value={value}
          onChange={(e) => {
            onValue(e.target.value);
            setMessage("");
          }}
        />
      </label>
      <button
        type="button"
        className="button quiet"
        disabled={props.disabled}
        onClick={paste}
      >
        <ClipboardPaste size={16} />
        Paste link
      </button>
      {message && (
        <p className="small muted" role="status">
          {message}
        </p>
      )}
    </div>
  );
}

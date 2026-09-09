"use client";

import { useState } from "react";
import { ClipboardPaste } from "lucide-react";
import { formatAddress, isAddress } from "@/features/formatting";
import styles from "./address-field.module.css";

export function AddressField({
  id,
  value,
  onChange,
  placeholder = "0x…",
  disabled = false,
  "aria-describedby": describedBy,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  "aria-describedby"?: string;
}) {
  const [focused, setFocused] = useState(false);
  const valid = isAddress(value);
  const display = focused || !valid ? value : formatAddress(value);

  async function paste() {
    if (!navigator.clipboard?.readText) return;
    try {
      onChange((await navigator.clipboard.readText()).trim());
    } catch {
      // Paste stays a best-effort convenience; the field remains editable.
    }
  }

  return (
    <div className={styles.field}>
      <input
        id={id}
        className={styles.input}
        value={display}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        aria-describedby={describedBy}
      />
      <button
        className={styles.paste}
        type="button"
        disabled={disabled}
        aria-label="Paste address"
        onClick={() => void paste()}
      >
        <ClipboardPaste size={18} strokeWidth={1.9} />
      </button>
    </div>
  );
}

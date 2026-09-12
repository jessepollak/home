"use client";

import { useState } from "react";
import { Button, Field, Input } from "@home/ui";
import { ClipboardPaste } from "lucide-react";
import { formatAddress, isAddress } from "@/shared/formatting";
import styles from "./address-field.module.css";

export function AddressField({
  id,
  label = "Address",
  value,
  onChange,
  placeholder = "0x…",
  disabled = false,
  "aria-describedby": describedBy,
}: {
  id: string;
  label?: string;
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
    <Field
      className={styles.field}
      label={label}
      htmlFor={id}
      action={(
        <Button
          className={styles.paste}
          variant="quiet"
          type="button"
          disabled={disabled}
          aria-label="Paste address"
          onClick={() => void paste()}
        >
          <ClipboardPaste size={18} strokeWidth={1.9} aria-hidden="true" />
        </Button>
      )}
    >
      <Input
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
    </Field>
  );
}

"use client";

import { useState } from "react";
import { ClipboardPaste } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatAddress, isAddress } from "@/shared/formatting";

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
    <Field>
      <div className="flex min-h-11 items-center justify-between gap-2">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <Button
          className="min-h-11 min-w-11 shrink-0 p-2"
          variant="ghost"
          size="icon"
          type="button"
          disabled={disabled}
          aria-label="Paste address"
          onClick={() => void paste()}
        >
          <ClipboardPaste size={18} strokeWidth={1.9} aria-hidden="true" />
        </Button>
      </div>
      <Input
        id={id}
        className="h-11 font-mono text-caption"
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

"use client";

import { useState } from "react";
import { ClipboardPaste } from "lucide-react";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
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
      <FieldLabel htmlFor={id} className="sr-only">
        {label}
      </FieldLabel>
      <InputGroup className="h-11">
        <InputGroupAddon align="inline-start">{label}</InputGroupAddon>
        <InputGroupInput
          id={id}
          className="h-11"
          variant="code"
          value={display}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          aria-label={label}
          aria-describedby={describedBy}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            className="size-11 shrink-0"
            size="icon-sm"
            disabled={disabled}
            aria-label="Paste address"
            onClick={() => void paste()}
          >
            <ClipboardPaste className="size-4" aria-hidden="true" />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </Field>
  );
}

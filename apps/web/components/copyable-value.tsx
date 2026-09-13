"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type CopyStatus = "idle" | "copied" | "unavailable" | "denied";

type CopyableValueProps = {
  value: string;
  /** Condensed label shown in the control. Defaults to the full value. */
  display?: string;
  className?: string;
  copiedLabel?: string;
  copyLabelPrefix?: string;
  /** Noun used in the accessible fallback label and error copy. */
  valueKind?: string;
  fallbackLabel?: string;
  /** Extra identity used to clear a stale confirmation when the owner changes. */
  resetKey?: string;
  copiedResetMs?: number;
};

/**
 * Shared tap-to-copy primitive.
 *
 * Copies the full `value` even when `display` is condensed (an address or a
 * transaction id). "Copied" is shown only after a successful write; denied or
 * missing clipboard access exposes the selectable full value plus a truthful
 * error. The confirmation is announced politely and clears on a timer or when
 * the value / owner changes.
 */
export function CopyableValue(props: CopyableValueProps) {
  const { value, resetKey } = props;
  return (
    <CopyableValueControl
      key={`${value}\u0000${resetKey ?? ""}`}
      {...props}
    />
  );
}

function CopyableValueControl({
  value,
  display,
  className,
  copiedLabel = "Copied",
  copyLabelPrefix = "Copy ",
  valueKind = "value",
  fallbackLabel,
  copiedResetMs = 1600,
}: CopyableValueProps) {
  const shown = display ?? value;
  const [status, setStatus] = useState<CopyStatus>("idle");
  const resetTimer = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (resetTimer.current !== null) {
      window.clearTimeout(resetTimer.current);
      resetTimer.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  async function copy() {
    clearTimer();
    if (!navigator.clipboard?.writeText) {
      setStatus("unavailable");
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setStatus("copied");
      resetTimer.current = window.setTimeout(() => {
        setStatus("idle");
        resetTimer.current = null;
      }, copiedResetMs);
    } catch {
      setStatus("denied");
    }
  }

  const controlLabel =
    status === "copied" ? copiedLabel : `${copyLabelPrefix}${shown}`;
  const selectableLabel = fallbackLabel ?? `Full ${valueKind} ${value}`;
  const errorMessage =
    status === "unavailable"
      ? `Clipboard access is unavailable. Select and copy the full ${valueKind} below.`
      : status === "denied"
        ? `Clipboard access failed. Select and copy the full ${valueKind} below.`
        : "";

  return (
    <>
      <Button
        variant="ghost"
        className={cn(
          "inline h-auto min-h-0 min-w-0 border-0 bg-transparent p-0 font-mono text-inherit no-underline transition-colors hover:bg-transparent active:translate-y-0",
          status === "copied" && "text-primary",
          className,
        )}
        title={value}
        aria-label={controlLabel}
        onClick={() => void copy()}
      >
        {status === "copied" ? copiedLabel : shown}
      </Button>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {status === "copied" ? copiedLabel : ""}
      </span>
      {status === "unavailable" || status === "denied" ? (
        <span className="mt-1.5 block">
          <span className="text-metadata block text-muted-foreground" role="alert">
            {errorMessage}
          </span>
          <code
            className="text-metadata mt-1.5 block w-full select-text overflow-wrap-anywhere rounded-md border border-border bg-muted px-3 py-2.5 font-mono text-foreground focus-visible:outline-3 focus-visible:outline-ring"
            aria-label={selectableLabel}
            tabIndex={0}
          >
            {value}
          </code>
        </span>
      ) : null}
    </>
  );
}

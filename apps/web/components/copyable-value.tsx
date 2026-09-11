"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./copyable-value.module.css";

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

  const controlClassName = [
    styles.text,
    status === "copied" ? styles.copied : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");
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
      <button
        type="button"
        className={controlClassName}
        title={value}
        aria-label={controlLabel}
        onClick={() => void copy()}
      >
        {status === "copied" ? copiedLabel : shown}
      </button>
      <span className={styles.srOnly} aria-live="polite" aria-atomic="true">
        {status === "copied" ? copiedLabel : ""}
      </span>
      {status === "unavailable" || status === "denied" ? (
        <span className={styles.fallback}>
          <span className={styles.error} role="alert">
            {errorMessage}
          </span>
          <code
            className={styles.fullValue}
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

"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatAddress, isAddress } from "@/shared/formatting";

function addressGroups(value: string): string[] {
  if (value !== value.trim() || !isAddress(value)) return [value];
  const hex = value.slice(6);
  return [value.slice(0, 6), ...(hex.match(/.{1,4}/g) ?? [])];
}

type CopyStatus = "idle" | "copied" | "unavailable" | "denied";

type CopyableValueProps = {
  value: string;
  display?: string;
  presentation?: "inline" | "full" | "compact" | "reveal";
  className?: string;
  copiedLabel?: string;
  copyLabelPrefix?: string;
  valueKind?: string;
  fallbackLabel?: string;
  resetKey?: string;
  copiedResetMs?: number;
};

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
  presentation = "inline",
  className,
  copiedLabel = "Copied",
  copyLabelPrefix = "Copy ",
  valueKind = "value",
  fallbackLabel,
  copiedResetMs = 1600,
}: CopyableValueProps) {
  const shown = display ?? value;
  const isFullWidth = presentation === "full" || presentation === "compact";
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

  if (presentation === "reveal") {
    const condensed = display ?? formatAddress(value);
    return (
      <Popover>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="inline"
              className={cn("min-w-0 w-full max-w-full min-h-11 justify-start text-start", className)}
              title={value}
              aria-label={`Show full ${valueKind} ${condensed}`}
            />
          }
        >
          <span className="flex min-w-0 items-center gap-2 font-mono text-sm">
            <span className="min-w-0 truncate">{condensed}</span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </span>
        </PopoverTrigger>
        <PopoverContent align="end" aria-label={`Full ${valueKind}`} className="w-96 max-w-[calc(100vw-2rem)]">
          <code
            className="block w-full select-all wrap-anywhere text-balance font-mono text-sm focus-visible:outline-3 focus-visible:outline-ring"
            aria-label={`Full ${valueKind} ${value}`}
            tabIndex={0}
          >
            {addressGroups(value).map((group, index) => (
              <Fragment key={index}>
                {index > 0 ? <wbr /> : null}
                <span className="me-1.5 last:me-0">{group}</span>
              </Fragment>
            ))}
          </code>
          <Button variant="outline" className="h-11 w-full" aria-label={status === "copied" ? copiedLabel : `Copy ${valueKind}`} onClick={() => void copy()}>
            {status === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {status === "copied" ? copiedLabel : `Copy ${valueKind}`}
          </Button>
          <span className="sr-only" aria-live="polite" aria-atomic="true">
            {status === "copied" ? copiedLabel : ""}
          </span>
          {status === "unavailable" || status === "denied" ? (
            <span className="text-xs text-muted-foreground" role="alert">
              {status === "unavailable"
                ? `Clipboard access is unavailable. Select the full ${valueKind} above to copy it.`
                : `Clipboard access failed. Select the full ${valueKind} above to copy it.`}
            </span>
          ) : null}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <>
      <Button
        variant="ghost"
        size="inline"
        className={cn(
          "min-w-0",
          isFullWidth &&
            "w-full max-w-full justify-start overflow-hidden text-start",
          (presentation === "full" || presentation === "compact") && "min-h-11",
          className,
        )}
        title={value}
        aria-label={controlLabel}
        onClick={() => void copy()}
      >
        <span
          className={cn(
            "font-mono text-inherit",
            isFullWidth &&
              "flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-sm",
            presentation === "full" && "py-2",
            status === "copied" && "text-primary",
          )}
        >
          <span
            className={cn(
              isFullWidth &&
                "min-w-0 flex-1 overflow-x-auto pe-2 whitespace-nowrap",
            )}
          >
            {status === "copied" ? copiedLabel : shown}
          </span>
          {isFullWidth ? (
            <Copy className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : null}
        </span>
      </Button>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {status === "copied" ? copiedLabel : ""}
      </span>
      {status === "unavailable" || status === "denied" ? (
        <span className="mt-1.5 block">
          <span className="block text-xs text-muted-foreground" role="alert">
            {errorMessage}
          </span>
          <code
            className="mt-1.5 block w-full select-text wrap-anywhere rounded-md border bg-muted px-3 py-2.5 font-mono text-xs text-foreground focus-visible:outline-3 focus-visible:outline-ring"
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

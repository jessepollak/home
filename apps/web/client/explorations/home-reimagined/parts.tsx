"use client";

import type { ReactNode } from "react";
import { MoneyTicker } from "@/components/money-ticker";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Item, ItemActions, ItemContent } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import type { ExplorationActivityEntry, ExplorationMovementStatus } from "./money-state";

/**
 * Shared presentation atoms for the Home reimagined exploration ([issue #662](https://github.com/jessepollak/home/issues/662)).
 *
 * These are the smallest pieces every direction needs: an exact money value, a fact list,
 * a truthfully-labelled status, and a notice. Each direction composes them differently;
 * none of them decides hierarchy, navigation, or tone on its own.
 */

/** Money is never re-derived here: `value` is an already-formatted display string. */
export function MoneyValue({
  value,
  emphasis = "md",
  label,
}: {
  value: string;
  emphasis?: "lg" | "md" | "sm";
  label?: string;
}) {
  return (
    <MoneyTicker
      animated={emphasis !== "sm"}
      align="start"
      value={value}
      aria-label={label ?? value}
      className={
        emphasis === "lg"
          ? "text-3xl leading-none font-semibold"
          : emphasis === "md"
            ? "text-xl font-semibold"
            : "text-sm font-medium"
      }
    />
  );
}

export type ExplorationFact = {
  label: string;
  value: string;
  detail?: string;
};

export function FactList({
  facts,
  label,
  size = "default",
}: {
  facts: readonly ExplorationFact[];
  label: string;
  size?: "default" | "compact";
}) {
  if (facts.length === 0) return null;
  return (
    <dl aria-label={label} className={size === "compact" ? "grid gap-1.5" : "grid gap-2.5"}>
      {facts.map((fact) => (
        <div
          key={fact.label}
          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"
        >
          <dt className="text-sm text-muted-foreground">{fact.label}</dt>
          <dd className="min-w-0 text-right text-sm font-medium break-words tabular-nums">
            {fact.value}
            {fact.detail ? (
              <span className="block text-xs font-normal text-muted-foreground">
                {fact.detail}
              </span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Loading semantics for a facts list. A value that is still loading is not rendered at all,
 * so a loading screen never reads as an unavailable or empty one.
 */
export function LoadingFacts({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-busy="true" className="grid gap-2.5">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center justify-between gap-4">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
      <span className="sr-only">Loading balances…</span>
    </div>
  );
}

/**
 * The status chip is exploration-owned rather than the owned `Badge` destructive variant,
 * whose light-on-light treatment measures 3.98:1 at 12px. A failed deposit still reads in
 * the destructive token, on the card surface where it passes AA (4.76:1).
 */
export function MovementStatusChip({ status }: { status: ExplorationMovementStatus }) {
  const label = status === "confirmed"
    ? "Confirmed"
    : status === "failed"
      ? "Failed"
      : status === "pending"
        ? "Pending"
        : "Unknown";
  return (
    <span
      className={
        status === "confirmed"
          ? "inline-flex h-6 shrink-0 items-center rounded-md border border-transparent bg-secondary px-2 text-xs font-medium text-secondary-foreground"
          : status === "failed"
            ? "inline-flex h-6 shrink-0 items-center rounded-md border border-destructive/30 px-2 text-xs font-medium text-destructive"
            : "inline-flex h-6 shrink-0 items-center rounded-md border border-border px-2 text-xs font-medium"
      }
    >
      {label}
    </span>
  );
}

/**
 * A polite status region for money that is in flight, incomplete, or unavailable. The
 * danger tone is reserved for something that already went wrong.
 */
export function MovementNotice({
  tone = "info",
  title,
  description,
  children,
}: {
  tone?: "info" | "danger";
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <Alert
      variant={tone === "danger" ? "destructive" : "default"}
      role="status"
      className="min-h-11"
    >
      <AlertTitle>{title}</AlertTitle>
      {description ? <AlertDescription>{description}</AlertDescription> : null}
      {children ? <div className="mt-2 flex flex-wrap gap-2">{children}</div> : null}
    </Alert>
  );
}

/**
 * One row from the combined money history: chain transfers that settled, and Home
 * movements that are still settling or did not settle. The status badge is the row's
 * truth; a pending row never reads as money that moved.
 */
export function ActivityEntryRow({
  entry,
  showStatus = true,
}: {
  entry: ExplorationActivityEntry;
  showStatus?: boolean;
}) {
  return (
    // The row wraps instead of nowrapping: a long vault name in the title folds onto the
    // next line while the amount, status, and date stay on the card at 390 CSS pixels.
    <Item className="min-h-14">
      <ItemContent className="min-w-0">
        <p className="text-sm leading-snug font-medium break-words">{entry.title}</p>
        {/* Plain prose so a long name, address, or a 200% text setting wraps instead of
            clipping, and never widens the card. */}
        <p className="text-sm leading-normal break-words text-muted-foreground">
          {entry.detail}
          <span className="block text-xs">{entry.dateLabel}</span>
        </p>
      </ItemContent>
      <ItemActions className="shrink-0 flex-col items-end">
        <span className="text-sm font-medium tabular-nums">{entry.amountLabel}</span>
        {showStatus && entry.status !== "confirmed" ? (
          <MovementStatusChip status={entry.status} />
        ) : null}
      </ItemActions>
    </Item>
  );
}

export function ChapterHeading({
  id,
  level = 2,
  tabIndex,
  children,
}: {
  id: string;
  level?: 2 | 3;
  /** Set to `-1` when the chapter is a programmatic focus target. */
  tabIndex?: -1;
  children: ReactNode;
}) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <Heading
      id={id}
      tabIndex={tabIndex}
      className="text-base leading-snug font-semibold outline-none"
    >
      {children}
    </Heading>
  );
}

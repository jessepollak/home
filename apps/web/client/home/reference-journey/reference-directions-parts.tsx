"use client";

import type { ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { MoneyTicker } from "@/components/money-ticker";
import { Skeleton } from "@/components/ui/skeleton";
import type { ReferenceHomeIntent } from "./reference-home";
import type { ReferencePositionView, ReferenceVaultView } from "./reference-position";

/**
 * Shared presentation pieces for the three direction examples in
 * [issue #654](https://github.com/jessepollak/home/issues/654).
 *
 * Every direction receives the same `ReferencePositionView` from
 * `presentReferencePosition`, so these pieces decide hierarchy, disclosure, and action
 * placement only — never values, units, or completeness. Proposal-only source: it is not
 * reachable from `HomeShell`, and no fixture in this module reaches a provider.
 */

/** A money value keeps the presenter's exact string; a missing slice renders as an em dash. */
export function ReferenceMoneyValue({
  value,
  className,
}: {
  value: string | null;
  className?: string;
}) {
  if (value === null) {
    return (
      <span className={["text-muted-foreground", className].filter(Boolean).join(" ")}>—</span>
    );
  }
  return (
    <MoneyTicker
      value={value}
      align="start"
      reserveDigits={false}
      className={["tabular-nums", className].filter(Boolean).join(" ")}
    />
  );
}

/** The hero's assets line keeps debt visible whenever the presenter exposes it. */
export function referenceDebtSuffix(position: ReferencePositionView): string {
  if (position.debtStatus === "shown") return ` · Debt ${position.debtLabel}`;
  if (position.debtStatus === "unavailable") return " · Debt unavailable";
  if (position.debtStatus === "loading") return " · Debt loading";
  return "";
}

/**
 * Cash is stated through this caption exactly once in the summary compositions, so the
 * available balance is never repeated between a hero line and a row.
 */
export function referenceCashCaption(position: ReferencePositionView): string {
  if (position.cash.status === "loading") return "Loading…";
  if (position.cash.status === "unavailable") return "Cash balance unavailable";
  return "Available";
}

/** Loading and unavailable savings never claim the customer has nothing saved. */
export function referenceSavedCaption(position: ReferencePositionView): string {
  if (position.saved.status === "loading") return "Loading…";
  if (position.saved.status === "unavailable") return "Saved balance unavailable";
  if (position.saved.status === "empty") return "Nothing saved yet";
  return position.saved.apyValueLabel
    ? `Earning ~${position.saved.apyValueLabel}`
    : position.saved.apyLabel ?? "Saved balance unavailable";
}

/**
 * Summary rows state the combined rate explicitly, while the Save hero keeps the
 * production `Earning ~x%` wording. Both read the same presenter fact.
 */
export function referenceSavedSummaryCaption(position: ReferencePositionView): string {
  if (position.saved.status === "loading") return "Loading…";
  if (position.saved.status === "unavailable") return "Saved balance unavailable";
  if (position.saved.status === "empty") return "Nothing saved yet";
  return position.saved.apyLabel ?? "APY unavailable";
}

export function ReferenceNetPositionHeadline({
  position,
}: {
  position: ReferencePositionView;
}) {
  const loading = position.status === "loading";
  return (
    <>
      <h1 className="text-sm font-normal text-muted-foreground">Net position</h1>
      {loading ? (
        <Skeleton className="h-10 w-48" data-shimmer="reference-directions-net-position" />
      ) : (
        <p className="break-words text-2xl font-semibold tabular-nums sm:text-4xl">
          <MoneyTicker
            value={position.netPositionLabel ?? "—"}
            align="start"
            reserveDigits={false}
          />
        </p>
      )}
      {position.debtStatus === "omitted" && position.assetsLabel === position.netPositionLabel ? null : (
        <p className="text-sm text-muted-foreground tabular-nums">
          {position.assetsLabel === null ? "Assets unavailable" : `Assets ${position.assetsLabel}`}
          {referenceDebtSuffix(position)}
        </p>
      )}
      {position.statusNote ? (
        <p className="text-xs text-muted-foreground" role="status">
          {position.statusNote}
        </p>
      ) : null}
    </>
  );
}

export function ReferenceNetPositionHeading({
  position,
}: {
  position: ReferencePositionView;
}) {
  return (
    <section aria-label="Net position" aria-busy={position.status === "loading" || undefined}>
      <Card variant="flush">
        <CardContent inset="hero">
          <ReferenceNetPositionHeadline position={position} />
        </CardContent>
      </Card>
    </section>
  );
}

export function ReferenceSavedHeadline({ position }: { position: ReferencePositionView }) {
  const loading = position.saved.status === "loading";
  return (
    <>
      <h1 className="text-sm font-normal text-muted-foreground">Saved</h1>
      {loading ? (
        <Skeleton className="h-10 w-48" data-shimmer="reference-directions-saved" />
      ) : (
        <p
          className={`break-words text-2xl font-semibold tracking-tight tabular-nums ${position.saved.funded ? "" : "text-muted-foreground"}`.trim()}
        >
          <MoneyTicker
            value={position.saved.totalLabel ?? "—"}
            align="start"
            reserveDigits={false}
          />
        </p>
      )}
      <p className="text-sm text-muted-foreground" role="status">
        {referenceSavedCaption(position)}
      </p>
    </>
  );
}

export function ReferenceSavedHeading({ position }: { position: ReferencePositionView }) {
  return (
    <section aria-label="Saved" aria-busy={position.saved.status === "loading" || undefined}>
      <Card variant="flush">
        <CardContent inset="hero">
          <ReferenceSavedHeadline position={position} />
        </CardContent>
      </Card>
    </section>
  );
}

export function ReferenceHomeActionBand({
  onIntent,
}: {
  onIntent?: (intent: ReferenceHomeIntent) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2" role="group" aria-label="Money actions">
      <Button
        size="lg"
        className="h-auto min-h-11 whitespace-normal"
        onClick={() => onIntent?.("add-money")}
      >
        Add money
      </Button>
      <Button
        size="lg"
        variant="outline"
        className="h-auto min-h-11 whitespace-normal"
        onClick={() => onIntent?.("send")}
      >
        Send
      </Button>
    </div>
  );
}

/** Deposit is the primary action; Withdraw stays quiet and both name the visible vault. */
export function ReferenceSaveActionBand({
  vaultName,
  depositEnabled,
  withdrawEnabled,
  onDeposit,
  onWithdraw,
}: {
  vaultName: string | null;
  depositEnabled: boolean;
  withdrawEnabled: boolean;
  onDeposit?: () => void;
  onWithdraw?: () => void;
}) {
  return (
    <div
      className="grid grid-cols-2 gap-2"
      role="group"
      aria-label={vaultName ? `Actions for ${vaultName}` : "Save actions"}
    >
      <Button
        size="lg"
        className="h-auto min-h-11 whitespace-normal"
        disabled={!depositEnabled}
        aria-label={vaultName ? `Deposit to ${vaultName}` : "Deposit"}
        onClick={onDeposit}
      >
        Deposit
      </Button>
      <Button
        size="lg"
        variant="outline"
        className="h-auto min-h-11 whitespace-normal"
        disabled={!withdrawEnabled}
        aria-label={vaultName ? `Withdraw from ${vaultName}` : "Withdraw"}
        onClick={onWithdraw}
      >
        Withdraw
      </Button>
    </div>
  );
}

/** Name, rate, and exact amount for one vault; readable when the name wraps. */
export function ReferenceVaultIdentity({
  vault,
  selected = false,
}: {
  vault: ReferenceVaultView;
  selected?: boolean;
}) {
  return (
    <>
      <ItemMedia variant="avatar" aria-hidden="true">
        {selected ? (
          <Check className="size-4 text-primary" />
        ) : (
          <span className="text-xs font-semibold text-foreground">{vault.initials}</span>
        )}
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="whitespace-normal break-words" truncate={false}>
          <span role="heading" aria-level={3}>
            {vault.name}
          </span>
        </ItemTitle>
        <ItemDescription>{vault.apyLabel}</ItemDescription>
        <ItemTitle numeric truncate={false}>
          <MoneyTicker value={vault.amountLabel} reserveDigits={false} />
        </ItemTitle>
      </ItemContent>
    </>
  );
}

export function ReferenceVaultDetails({
  vault,
  id,
}: {
  vault: ReferenceVaultView;
  id?: string;
}) {
  return (
    <dl
      id={id}
      aria-label={`${vault.name} details`}
      className="grid grid-cols-2 gap-4 border-t px-3 py-3"
    >
      <div className="min-w-0">
        <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Fee</dt>
        <dd className="mt-1 text-sm tabular-nums">{vault.feeLabel}</dd>
      </div>
      <div className="min-w-0 text-right">
        <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Curator
        </dt>
        <dd className="mt-1 min-w-0 break-words text-sm">{vault.curatorLabel}</dd>
      </div>
    </dl>
  );
}

/**
 * A real disclosure: the toggle owns `aria-expanded` / `aria-controls` and the panel
 * stays mounted with `hidden`, so `aria-controls` always resolves.
 */
export function ReferenceDisclosureRow({
  id,
  expanded,
  onToggle,
  toggleLabel,
  heading,
  summary,
  children,
}: {
  id: string;
  expanded: boolean;
  onToggle: () => void;
  toggleLabel: string;
  heading: ReactNode;
  summary?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="border-b last:border-b-0">
      <Button
        type="button"
        variant="ghost"
        size="lg"
        className="h-auto min-h-11 w-full flex-wrap items-center justify-between text-left whitespace-normal"
        aria-label={toggleLabel}
        aria-expanded={expanded}
        aria-controls={id}
        onClick={onToggle}
      >
        <span className="min-w-0 flex-1">{heading}</span>
        <span className="flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 text-sm text-foreground tabular-nums">
          {summary}
          <ChevronDown
            className={`size-4 shrink-0 transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`.trim()}
            aria-hidden="true"
          />
        </span>
      </Button>
      <div id={id} hidden={!expanded}>
        {children}
      </div>
    </div>
  );
}

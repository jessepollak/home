"use client";

import type { ReactNode } from "react";
import { Bitcoin, ChevronRight, PiggyBank } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { MoneyTicker } from "@/components/money-ticker";
import { HomeProductTile } from "@/client/home/product-tile";
import { HomeBalanceRowView } from "@/client/home/balances-panel";
import { ShimmerRows } from "@/client/home/panel-shared";
import type { ReferencePositionView } from "./reference-position";

/**
 * Reference Home composition for [issue #654](https://github.com/jessepollak/home/issues/654).
 *
 * `variant` is an explicit composition contract, not a theme switch:
 * - `ledger` is the recommended Option A. Cash, Save, and Borrow live in one money ledger
 *   with row-level disclosure; Home holds fewer containers and one primary action group.
 * - `tiles` is Option B. Save and Borrow stay first-class product tiles next to a
 *   Cash-only money card, matching today's hub-and-drill-down grouping more closely.
 *
 * Both variants receive the same position view, so the comparison never changes data,
 * labels, or formatting. This component is production-intended proposal source; it is not
 * wired into `HomeShell`, and fixture state replaces production queries.
 */

export type ReferenceHomeVariant = "ledger" | "tiles";
export type ReferenceHomeIntent = "add-money" | "send" | "cash-out";

export type ReferenceHomeCompositionProps = {
  variant: ReferenceHomeVariant;
  position: ReferencePositionView;
  /** The production Activity panel for this surface; the composition does not restyle it. */
  activityContent: ReactNode;
  onIntent?: (intent: ReferenceHomeIntent) => void;
  /** Carries the vault the customer came from so Save opens the same selection. */
  onOpenSave?: (vaultAddress?: string) => void;
  onOpenBorrow?: () => void;
  onOpenMoney?: () => void;
};

export function ReferenceHomeComposition({
  variant,
  position,
  activityContent,
  onIntent,
  onOpenSave,
  onOpenBorrow,
  onOpenMoney,
}: ReferenceHomeCompositionProps) {
  return (
    <div className="space-y-4">
      <ReferencePositionHero position={position} />

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
        {variant === "ledger" ? (
          <Button
            size="lg"
            variant="outline"
            className="col-span-2 h-auto min-h-11 whitespace-normal"
            onClick={() => onIntent?.("cash-out")}
          >
            Cash out
          </Button>
        ) : null}
      </div>

      {variant === "ledger" ? (
        <ReferenceMoneyLedger
          position={position}
          onOpenSave={onOpenSave}
          onOpenBorrow={onOpenBorrow}
          onOpenMoney={onOpenMoney}
        />
      ) : (
        <>
          <ReferenceCashCard position={position} onOpenMoney={onOpenMoney} />
          <div className="grid grid-cols-2 gap-2">
            <section className="min-w-0 aspect-square sm:aspect-[3/2]" aria-labelledby="reference-save-heading">
              <Card variant="flush" className="h-full">
                <HomeProductTile
                  actionLabel="Manage"
                  headingId="reference-save-heading"
                  icon={<PiggyBank className="size-4" aria-hidden="true" />}
                  onOpen={() => onOpenSave?.(position.saved.vaults[0]?.vaultAddress)}
                  primary={
                    <MoneyTicker value={position.saved.totalLabel ?? "—"} align="start" reserveDigits={false} />
                  }
                  secondary={savedCaption(position)}
                  title="Save"
                />
              </Card>
            </section>
            <section className="min-w-0 aspect-square sm:aspect-[3/2]" aria-labelledby="reference-borrow-heading">
              <Card variant="flush" className="h-full">
                <HomeProductTile
                  actionLabel="Borrow"
                  headingId="reference-borrow-heading"
                  icon={<Bitcoin className="size-4" aria-hidden="true" />}
                  onOpen={() => onOpenBorrow?.()}
                  primary="Borrow"
                  secondary={borrowContext(position)}
                  title="Borrow"
                />
              </Card>
            </section>
          </div>
        </>
      )}

      {/* The Activity panel already owns its card and labelled region. */}
      <div>{activityContent}</div>
    </div>
  );
}

/** Shared Activity section heading for the reference Home composition. */
export function ReferenceActivityHeader({ onOpen }: { onOpen?: () => void }) {
  return (
    <>
      <CardTitle id="activity-title" role="heading" aria-level={2}>
        Activity
      </CardTitle>
      {onOpen ? (
        <CardAction>
          <Button size="card-action" variant="ghost" onClick={onOpen} aria-label="Activity">
            See all
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </CardAction>
      ) : null}
    </>
  );
}

export function ReferencePositionHero({ position }: { position: ReferencePositionView }) {
  const loading = position.status === "loading";
  return (
    <section aria-label="Net position" aria-busy={loading || undefined}>
      <Card variant="flush">
      <CardContent inset="hero">
        <h1 className="text-sm font-normal text-muted-foreground">Net position</h1>
        {loading ? (
          <Skeleton className="h-10 w-48" data-shimmer="reference-hero" />
        ) : (
          <p className="break-words text-2xl font-semibold tabular-nums sm:text-4xl">
            <MoneyTicker value={position.netPositionLabel ?? "—"} align="start" reserveDigits={false} />
          </p>
        )}
        <p className="text-sm text-muted-foreground tabular-nums">
          {position.assetsLabel === null ? "Assets unavailable" : `Assets ${position.assetsLabel}`}
          {position.debtStatus === "shown"
            ? ` · Debt ${position.debtLabel}`
            : position.debtStatus === "unavailable"
              ? " · Debt unavailable"
              : position.debtStatus === "loading"
                ? " · Debt loading"
                : null}
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {position.availableLabel === null
            ? "Available to use unavailable"
            : `Available to use ${position.availableLabel}`}
        </p>
        {position.statusNote ? (
          <p className="text-xs text-muted-foreground" role="status">
            {position.statusNote}
          </p>
        ) : null}
      </CardContent>
      </Card>
    </section>
  );
}

function ReferenceMoneyLedger({
  position,
  onOpenSave,
  onOpenBorrow,
  onOpenMoney,
}: {
  position: ReferencePositionView;
  onOpenSave?: (vaultAddress?: string) => void;
  onOpenBorrow?: () => void;
  onOpenMoney?: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle id="reference-money-heading" role="heading" aria-level={2}>
          Your money
        </CardTitle>
        {onOpenMoney ? (
          <CardAction>
            <Button size="card-action" variant="ghost" onClick={onOpenMoney} aria-label="Your money">
              See all
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent inset="list">
        <section aria-labelledby="reference-cash-heading">
          <ReferenceLedgerHeading
            id="reference-cash-heading"
            label="Cash"
            value={position.cash.subtotalLabel}
          />
          {position.cash.status === "loading" ? <ShimmerRows count={1} /> : null}
          {position.cash.rows.length > 0 ? (
            <ul className="list-none p-0">
              {position.cash.rows.map((row) => <HomeBalanceRowView key={row.key} row={row} />)}
            </ul>
          ) : position.cash.status === "unavailable" ? (
            <p className="px-3 pt-1 pb-2 text-sm text-muted-foreground">Cash balance unavailable</p>
          ) : null}
          {position.cash.rows.length > 1 && position.statusNote ? (
            <p className="px-3 pt-1 text-xs text-muted-foreground" role="status">
              {position.statusNote}
            </p>
          ) : null}
        </section>

        <section className="pt-2" aria-labelledby="reference-save-heading">
          <ReferenceLedgerHeading
            id="reference-save-heading"
            label="Save"
            value={position.saved.totalLabel}
            context={position.saved.apyLabel}
          />
          {position.saved.status === "loading" ? <ShimmerRows count={2} /> : null}
          {position.saved.vaults.some((vault) => vault.funded) ? (
            <ul className="list-none p-0">
              {position.saved.vaults.filter((vault) => vault.funded).map((vault) => (
                <li key={vault.vaultAddress}>
                  <Item
                    render={<Button type="button" variant="ghost" />}
                    size="sm"
                    className="h-auto min-h-11 flex-nowrap items-start text-left justify-start"
                    onClick={() => onOpenSave?.(vault.vaultAddress)}
                    aria-label={`Open ${vault.name} in Save`}
                  >
                    <ItemContent className="min-w-0">
                      <ItemTitle className="w-full whitespace-normal break-words" truncate={false}>
                        {vault.name}
                      </ItemTitle>
                      <ItemDescription lines={1}>{vault.apyLabel}</ItemDescription>
                      <ItemTitle numeric truncate={false}>
                        <MoneyTicker value={vault.amountLabel} reserveDigits={false} />
                      </ItemTitle>
                    </ItemContent>
                    <ItemActions aria-hidden="true">
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </ItemActions>
                  </Item>
                </li>
              ))}
            </ul>
          ) : position.saved.status === "empty" ? (
            <div className="px-3 pb-2">
              <Empty className="items-start justify-start text-left">
                <EmptyHeader className="items-start">
                  <EmptyTitle>Nothing saved yet</EmptyTitle>
                </EmptyHeader>
              </Empty>
              <Button
                variant="outline"
                size="lg"
                className="h-auto min-h-11 w-full whitespace-normal"
                onClick={() => onOpenSave?.(position.saved.vaults[0]?.vaultAddress)}
              >
                Get started
              </Button>
            </div>
          ) : position.saved.status === "unavailable" ? (
            <p className="px-3 pt-1 pb-2 text-sm text-muted-foreground">Saved balance unavailable</p>
          ) : null}
        </section>

        <section className="pt-2" aria-labelledby="reference-borrow-heading">
          <ReferenceLedgerHeading id="reference-borrow-heading" label="Borrow" value={null} />
          <Item
            render={<Button type="button" variant="ghost" />}
            size="sm"
            className="h-auto min-h-11 flex-nowrap items-start text-left justify-start"
            onClick={onOpenBorrow}
            aria-label="Borrow"
          >
            <ItemContent>
              <ItemTitle className="whitespace-normal break-words" truncate={false}>
                Borrow against your investments
              </ItemTitle>
              <ItemDescription lines={1}>{borrowContext(position)}</ItemDescription>
            </ItemContent>
            <ItemActions aria-hidden="true">
              <ChevronRight className="size-4 text-muted-foreground" />
            </ItemActions>
          </Item>
        </section>
      </CardContent>
    </Card>
  );
}

function ReferenceCashCard({
  position,
  onOpenMoney,
}: {
  position: ReferencePositionView;
  onOpenMoney?: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle id="reference-money-heading" role="heading" aria-level={2}>
          Your money
        </CardTitle>
        {onOpenMoney ? (
          <CardAction>
            <Button size="card-action" variant="ghost" onClick={onOpenMoney} aria-label="Your money">
              See all
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent inset="list">
        <ReferenceLedgerHeading
          id="reference-cash-heading"
          label="Cash"
          value={position.cash.subtotalLabel}
        />
        {position.cash.status === "loading" ? <ShimmerRows count={1} /> : null}
        {position.cash.rows.length > 0 ? (
          <ul className="list-none p-0">
            {position.cash.rows.map((row) => <HomeBalanceRowView key={row.key} row={row} />)}
          </ul>
        ) : position.cash.status === "unavailable" ? (
          <p className="px-3 pt-1 pb-2 text-sm text-muted-foreground">Cash balance unavailable</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ReferenceLedgerHeading({
  id,
  label,
  value,
  context,
}: {
  id: string;
  label: string;
  value: string | null;
  context?: string | null;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3 pt-3 pb-1">
      <h3 id={id} className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
        {label}
      </h3>
      <span className="flex min-w-0 flex-wrap items-baseline justify-end gap-x-2 gap-y-1 text-right text-xs text-muted-foreground tabular-nums">
        {context ? <span>{context}</span> : null}
        {value ? <MoneyTicker value={value} reserveDigits={false} /> : null}
      </span>
    </div>
  );
}

/** Loading and unavailable savings never claim the customer has nothing saved. */
function savedCaption(position: ReferencePositionView): string {
  if (position.saved.status === "loading") return "Loading…";
  if (position.saved.status === "unavailable") return "Saved balance unavailable";
  if (position.saved.status === "empty") return "Nothing saved yet";
  return position.saved.apyLabel ?? "Saved balance unavailable";
}

function borrowContext(position: ReferencePositionView): string {
  if (position.debtStatus === "shown") return `Debt ${position.debtLabel}`;
  if (position.debtStatus === "unavailable") return "Debt unavailable";
  if (position.debtStatus === "loading") return "Loading debt…";
  return "No current debt";
}

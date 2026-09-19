"use client";

import {
  BriefcaseBusiness,
  CreditCard,
  Landmark,
  LockKeyhole,
  PiggyBank,
  Wallet,
} from "lucide-react";
import { useId, type ReactNode } from "react";
import { BalanceRow } from "@/components/finance-rows";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { HomeProductTile } from "./product-tile";
import {
  formatMoneyPositionAmount,
  moneyPositionKindTotal,
  moneyPositionStatusMessage,
  shouldPresentMoneyPositionDebt,
  summarizeMoneyPosition,
  type MoneyPositionInput,
  type MoneyPositionKind,
  type MoneyPositionSlice,
} from "./money-position-model";

const groupOrder = ["available", "growing", "committed"] as const;
type PositionGroup = (typeof groupOrder)[number];

const groupLabels: Record<PositionGroup, string> = {
  available: "Available",
  growing: "Saved & invested",
  committed: "Committed",
};

function groupForKind(kind: MoneyPositionKind): PositionGroup {
  if (kind === "cash") return "available";
  if (kind === "saved" || kind === "invested") return "growing";
  return "committed";
}

function positionIcon(kind: MoneyPositionKind): ReactNode {
  if (kind === "cash") return <Wallet className="size-4" />;
  if (kind === "saved") return <PiggyBank className="size-4" />;
  if (kind === "invested") return <BriefcaseBusiness className="size-4" />;
  if (kind === "collateral") return <LockKeyhole className="size-4" />;
  return <CreditCard className="size-4" />;
}

function sliceContext(slice: MoneyPositionSlice): string {
  if (slice.status === "unavailable") {
    return slice.unavailableReason ?? "Current value unavailable";
  }
  if (slice.kind === "collateral") return `${slice.detail} · Locked, not available to spend`;
  if (slice.kind === "card") return `${slice.detail} · Allocated, not in cash`;
  if (slice.status === "stale") return `${slice.detail} · Last verified value`;
  return slice.detail;
}

export function MoneyPositionProposal({
  position,
  onAddMoney,
}: {
  position: MoneyPositionInput;
  onAddMoney?: () => void;
}) {
  const summary = summarizeMoneyPosition(position);
  const statusMessage = moneyPositionStatusMessage(summary);
  const showDebtFact = shouldPresentMoneyPositionDebt(summary);
  const format = (value: bigint | null) => formatMoneyPositionAmount(value, position);
  const visibleSlices = position.slices.filter((slice) =>
    slice.amountMinor === null ||
    slice.status === "unavailable" ||
    BigInt(slice.amountMinor) > BigInt(0));
  const hasDebt = position.debt.amountMinor === null ||
    position.debt.status === "unavailable" ||
    BigInt(position.debt.amountMinor) > BigInt(0);
  const isEmpty = visibleSlices.length === 0 && !hasDebt && summary.status === "complete";

  return (
    <section className="mx-auto w-full max-w-2xl space-y-3" aria-label="Money position proposal">
      <Card variant="flush">
        <CardContent inset="hero">
          <p className="text-sm text-muted-foreground">Net position</p>
          <p className="break-words text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl">
            {format(summary.netPositionMinor)}
          </p>
          <p className="text-sm text-muted-foreground tabular-nums">
            Assets {format(summary.assetsMinor)}
            {showDebtFact
              ? <> · Debt {format(summary.debtMinor === null ? null : -summary.debtMinor)}</>
              : null}
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">
            Available to use {format(summary.spendableMinor)}
          </p>
          {statusMessage ? (
            <p className="rounded-lg border px-3 py-2 text-sm text-muted-foreground" role="status">
              {statusMessage}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>Your money</CardTitle>
          <CardDescription>Each amount appears once, by its current job.</CardDescription>
        </CardHeader>
        <CardContent inset="list">
          {isEmpty ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No money yet</EmptyTitle>
                <EmptyDescription>Add money to make it available to use.</EmptyDescription>
              </EmptyHeader>
              {onAddMoney ? (
                <EmptyContent>
                  <Button onClick={onAddMoney}>Add money</Button>
                </EmptyContent>
              ) : null}
            </Empty>
          ) : (
            <div className="space-y-4">
              {groupOrder.map((group) => {
                const slices = visibleSlices.filter((slice) => groupForKind(slice.kind) === group);
                if (slices.length === 0) return null;
                return (
                  <section key={group} aria-labelledby={`money-position-${group}`}>
                    <h3
                      className="px-3 pt-2 pb-1 text-xs font-medium tracking-wider text-muted-foreground uppercase"
                      id={`money-position-${group}`}
                    >
                      {groupLabels[group]}
                    </h3>
                    <ul className="list-none p-0">
                      {slices.map((slice) => {
                        const amount = slice.status === "unavailable" || slice.amountMinor === null
                          ? null
                          : BigInt(slice.amountMinor);
                        return (
                          <BalanceRow
                            key={slice.id}
                            icon={positionIcon(slice.kind)}
                            label={slice.label}
                            context={sliceContext(slice)}
                            value={format(amount)}
                            valueTone={slice.status === "unavailable" ? "error" : "default"}
                          />
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
              {hasDebt ? (
                <section aria-labelledby="money-position-owed">
                  <h3
                    className="px-3 pt-2 pb-1 text-xs font-medium tracking-wider text-muted-foreground uppercase"
                    id="money-position-owed"
                  >
                    Owed
                  </h3>
                  <ul className="list-none p-0">
                    <BalanceRow
                      icon={<Landmark className="size-4" />}
                      label={position.debt.label}
                      context={
                        position.debt.status === "unavailable"
                          ? position.debt.unavailableReason ?? "Current debt unavailable"
                          : position.debt.status === "stale"
                            ? `${position.debt.detail} · Last verified value`
                            : position.debt.detail
                      }
                      value={format(summary.debtMinor === null ? null : -summary.debtMinor)}
                      valueTone={position.debt.status === "unavailable" ? "error" : "default"}
                    />
                  </ul>
                </section>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

export function MoneyPositionProductTiles({
  position,
  onOpenSave,
  onOpenBorrow,
}: {
  position: MoneyPositionInput;
  onOpenSave: () => void;
  onOpenBorrow: () => void;
}) {
  const id = useId();
  const summary = summarizeMoneyPosition(position);
  const savedMinor = moneyPositionKindTotal(position, "saved");
  const collateralMinor = moneyPositionKindTotal(position, "collateral");
  const format = (value: bigint | null) => formatMoneyPositionAmount(value, position);

  return (
    <div className="mx-auto grid w-full max-w-2xl grid-cols-2 gap-2" aria-label="Save and Borrow position summaries">
      <section className="min-w-0 aspect-square sm:aspect-[3/2]" aria-labelledby={`${id}-save`}>
        <Card variant="flush" className="h-full">
          <HomeProductTile
            actionLabel="Manage"
            headingId={`${id}-save`}
            icon={<PiggyBank className="size-4" aria-hidden="true" />}
            onOpen={onOpenSave}
            primary={format(savedMinor)}
            secondary="Saved outside available cash"
            title="Save"
          />
        </Card>
      </section>
      <section className="min-w-0 aspect-square sm:aspect-[3/2]" aria-labelledby={`${id}-borrow`}>
        <Card variant="flush" className="h-full">
          <HomeProductTile
            actionLabel="Manage"
            headingId={`${id}-borrow`}
            icon={<Landmark className="size-4" aria-hidden="true" />}
            onOpen={onOpenBorrow}
            primary={format(summary.debtMinor === null ? null : -summary.debtMinor)}
            secondary={`${format(collateralMinor)} locked as collateral`}
            title="Borrow"
          />
        </Card>
      </section>
    </div>
  );
}

export function BorrowPositionHeaderProposal({ position }: { position: MoneyPositionInput }) {
  const summary = summarizeMoneyPosition(position);
  const collateralMinor = moneyPositionKindTotal(position, "collateral");
  const format = (value: bigint | null) => formatMoneyPositionAmount(value, position);

  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>Borrow position</CardTitle>
        <CardDescription>Debt and locked collateral stay separate from available cash.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-3 tabular-nums sm:grid-cols-3">
          <div className="min-w-0 rounded-lg bg-muted/50 p-3">
            <dt className="text-xs text-muted-foreground">Borrowed</dt>
            <dd className="break-words font-semibold">
              {format(summary.debtMinor === null ? null : -summary.debtMinor)}
            </dd>
          </div>
          <div className="min-w-0 rounded-lg bg-muted/50 p-3">
            <dt className="text-xs text-muted-foreground">Collateral locked</dt>
            <dd className="break-words font-semibold">{format(collateralMinor)}</dd>
          </div>
          <div className="min-w-0 rounded-lg bg-muted/50 p-3">
            <dt className="text-xs text-muted-foreground">Position after debt</dt>
            <dd className="break-words font-semibold">{format(summary.netPositionMinor)}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

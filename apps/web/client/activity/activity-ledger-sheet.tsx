"use client";

import { useId, useState, type ReactNode } from "react";
import { ArrowDownLeft, CircleAlert, CircleCheck, CircleQuestionMark, CircleX, Clock, LoaderCircle } from "lucide-react";
import { MoneyModal, MoneyModalBody, MoneyModalFooter, MoneyModalHeader } from "@/client/money-modal";
import { useAutoFitAmountText } from "@/client/money-modal/amount";
import { CopyableValue } from "@/components/copyable-value";
import { CurrencyMark } from "@/components/currency-mark";
import { AssetRow } from "@/components/finance-rows";
import { Alert, AlertIcon, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DrawerFooter } from "@/components/ui/drawer";
import { StatusStep, StatusSteps } from "@/components/ui/status-step";
import { formatAddress } from "@/shared/formatting";
import { isActivityLedgerNextActionAllowed, needsCustomer, ownerDefaults, statusWords, type ActivityLedgerFact, type ActivityLedgerItem, type ActivityLedgerNextActionKind, type Transaction } from "./activity-ledger";

function statusBadge(item: ActivityLedgerItem) {
  const status = item.status;
  const customerAction = needsCustomer(item);
  const Icon = {
    "waiting-customer": customerAction ? CircleAlert : Clock,
    "waiting-provider": Clock,
    "waiting-chain": LoaderCircle,
    "waiting-home": Clock,
    confirmed: CircleCheck,
    failed: CircleX,
    expired: Clock,
    ambiguous: CircleQuestionMark,
    reversed: customerAction ? CircleAlert : ArrowDownLeft,
    refunded: CircleCheck,
  }[status];
  const words = item.statusLabel ?? (status === "confirmed" ? "Confirmed"
    : status === "failed" && item.family === "card" ? "Declined"
      : ["waiting-customer", "waiting-provider", "waiting-chain", "waiting-home"].includes(status)
        ? "Pending" : status === "ambiguous" ? "Unconfirmed" : statusWords[status]);
  const variant = status === "failed" ? "destructive"
    : status === "ambiguous" || customerAction
      ? "outline" : "secondary";
  return (
    <Badge variant={variant}>
      <Icon aria-hidden="true" />{words}
    </Badge>
  );
}

function DetailHeadline({ item }: { item: ActivityLedgerItem }) {
  const { amount, symbol } = item.detailAmountParts ?? { amount: item.detailAmount ?? item.amount, symbol: "" };
  const { containerRef, sizerRef, fontSize, overflows } = useAutoFitAmountText<HTMLParagraphElement>(amount, { minRem: 1.5 });
  return (
    <>
      <p ref={containerRef} className={`w-full min-w-0 max-w-full text-center text-4xl font-semibold tabular-nums ${
        item.direction === "in" && (item.status === "confirmed" || item.status === "refunded")
          ? "text-market-gain" : ""
      }`} style={fontSize === undefined ? undefined : { fontSize }}>
        <bdi dir="ltr" className="inline-flex max-w-full flex-wrap items-baseline justify-center gap-x-2">
          <span data-slot="activity-amount-scroll"
            className="min-w-0 max-w-full overflow-x-auto overflow-y-hidden rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            {...(overflows ? { tabIndex: 0, role: "region", "aria-label": `Amount: ${amount}${symbol ? ` ${symbol}` : ""}` } : {})}>
            <span data-slot="activity-amount-number" className="whitespace-nowrap">{amount}</span>
          </span>
          {symbol ? <>{" "}<span data-slot="activity-amount-unit" className="min-w-0 max-w-full wrap-anywhere">{symbol}</span></> : null}
        </bdi>
      </p>
      <span ref={sizerRef} aria-hidden="true"
        className="pointer-events-none absolute invisible whitespace-nowrap text-4xl font-semibold tabular-nums">{amount}</span>
    </>
  );
}

function factEntry(fact: ActivityLedgerFact, key: string): [string, ReactNode] {
  return [fact.label, fact.kind === "address" ? (
    <CopyableValue key={key} value={fact.value} display={formatAddress(fact.value)} presentation="compact"
      className="justify-end text-end" valueKind="address" />
  ) : fact.value];
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      className={`grid min-h-11 grid-cols-[minmax(6rem,0.65fr)_minmax(0,1.35fr)]
        items-center gap-3 px-3 text-sm`}
    >
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-end wrap-anywhere">{children}</dd>
    </div>
  );
}

export type ActivityLedgerDetailSheetProps = {
  item: ActivityLedgerItem | null;
  open: boolean;
  onDismiss: () => void;
  immediate?: boolean;
  onClosed?: () => void;
  onAction: (item: ActivityLedgerItem, kind: ActivityLedgerNextActionKind) => void;
  canOpenAsset?: (assetKey: string) => boolean;
  onOpenAsset?: (item: ActivityLedgerItem) => void;
  actionBusy?: boolean;
  actionError?: string | null;
};

export function ActivityLedgerDetailSheet({
  item, open, immediate = false, onDismiss, onClosed, onAction, canOpenAsset, onOpenAsset,
  actionBusy = false, actionError = null,
}: ActivityLedgerDetailSheetProps) {
  const titleId = useId();
  const [shown, setShown] = useState(item);
  if (item && item !== shown) setShown(item);
  item = item ?? shown;
  const action = item?.nextAction && isActivityLedgerNextActionAllowed(
    item.status, item.family, item.nextAction.kind,
  ) ? item.nextAction : null;
  const owner = item && item.status !== "confirmed" && item.status !== "refunded"
    ? item.ownerSentence ?? ownerDefaults[item.status] : null;
  const StatusIcon = item ? {
    "waiting-customer": Clock,
    "waiting-provider": Clock,
    "waiting-chain": LoaderCircle,
    "waiting-home": Clock,
    confirmed: CircleCheck,
    failed: CircleX,
    expired: Clock,
    ambiguous: CircleQuestionMark,
    reversed: ArrowDownLeft,
    refunded: CircleCheck,
  }[item.status] : Clock;
  const facts: Array<[string, ReactNode]> = [];
  let transaction: Transaction | undefined;
  if (item) {
    if (
      item.family === "onchain-transfer" || item.family === "home-action" || item.family === "card"
    ) {
      facts.push(["Date", <time key="date" dateTime={item.timestamp}>{item.fullDateLabel ?? item.dateLabel}</time>]);
    }
    if (item.family === "onchain-transfer") {
      facts.push(
        [item.detail.counterpartyLabel, (
          <CopyableValue
            key={`${item.id}-counterparty`}
            value={item.detail.counterparty}
            display={formatAddress(item.detail.counterparty)}
            presentation="compact"
            className="justify-end text-end"
            valueKind="address"
          />
        )],
        ["Network", item.detail.network],
      );
      facts.push(...(item.detail.facts ?? []).map((fact) => factEntry(fact, `${item.id}-${fact.label}`)));
      transaction = item.detail.transaction;
    } else if (item.family === "home-action") {
      if (item.detail.operation !== item.title) facts.push(["Operation", item.detail.operation]);
      if (item.detail.from) facts.push(["From", item.detail.from]);
      facts.push(["Network", item.detail.network]);
      facts.push(...(item.detail.facts ?? []).map((fact) => factEntry(fact, `${item.id}-${fact.label}`)));
      transaction = item.detail.transaction;
    } else if (item.family === "funding-order" || item.family === "cash-out-order") {
      facts.push(
        ["Provider", item.detail.provider],
        [
          item.family === "funding-order" ? "Payment method" : "Payout method",
          item.family === "funding-order" ? item.detail.paymentMethod : item.detail.payoutMethod,
        ],
      );
      facts.push(["Order ID", (
        <CopyableValue
          key={item.id}
          value={item.detail.orderId}
          display={item.detail.orderId}
          presentation="compact"
          className="justify-end text-end"
          valueKind="order ID"
        />
      )]);
    } else {
      facts.push(["Merchant", item.detail.merchant], ["Card", item.detail.cardLabel]);
      if (item.detail.originalPurchase) {
        facts.push(["Original purchase", item.detail.originalPurchase]);
      }
      if (item.detail.reference) facts.push(["Reference", item.detail.reference]);
    }
    if (transaction) facts.push(["Transaction", (
      <CopyableValue
        key={item.id}
        value={transaction.value}
        display={transaction.display}
        presentation="compact"
        className="justify-end text-end"
        valueKind="transaction hash"
      />
    )]);
  }
  return (
    <MoneyModal open={open} labelledBy={titleId} immediate={immediate} onCancel={onDismiss}
      onClose={() => onClosed?.()}>
      <MoneyModalHeader
        title={item?.title ?? "Activity"}
        titleId={titleId}
        closeLabel={`Close ${item?.title ?? "activity"} details`}
      />
      <MoneyModalBody hasFooter={Boolean(action)} className="gap-4 pt-4">
        {item ? (
          <>
            <div className="flex min-w-0 flex-col items-center gap-2 py-3">
              <DetailHeadline item={item} />
              {item.detailValue !== undefined ? (
                <p className="text-center text-sm tabular-nums text-muted-foreground">
                  <bdi dir="ltr">{item.detailValue}</bdi>
                </p>
              ) : null}
              {statusBadge(item)}
            </div>
            {owner ? (
              <Alert variant={item.status === "failed" ? "destructive" : "default"}>
                <AlertIcon><StatusIcon /></AlertIcon>
                <AlertTitle>{owner.title}</AlertTitle>
                {owner.description ? (
                  <AlertDescription>{owner.description}</AlertDescription>
                ) : null}
              </Alert>
            ) : null}
            {(item.family === "home-action" || item.family === "funding-order" ||
              item.family === "cash-out-order") && item.steps?.length ? (
              <StatusSteps>
                {item.steps.map((step, index) => (
                  <StatusStep key={`${index}:${step.title}`} {...step} />
                ))}
              </StatusSteps>
            ) : null}
            <Card variant="flush">
              <CardContent inset="list">
                {item.detailAsset ? (
                  <ul className="list-none p-0">
                    <AssetRow
                      icon={<CurrencyMark assetKey={item.detailAsset.assetKey}
                        symbol={item.detailAsset.symbol} src={item.detailAsset.imageUrl} size="sm" />}
                      iconTone="mark"
                      label={item.detailAsset.name}
                      context="Asset"
                      {...(item.detailAsset.openable && onOpenAsset && canOpenAsset?.(item.detailAsset.assetKey)
                        ? { onActivate: () => onOpenAsset(item), activateLabel: `View ${item.detailAsset.name}` }
                        : { chevron: false })}
                    />
                  </ul>
                ) : null}
                <dl>
                  {facts.map(([label, value]) => <Fact key={label} label={label}>{value}</Fact>)}
                </dl>
              </CardContent>
            </Card>
            {transaction?.explorer ? (
              <a
                className={`self-end text-sm font-medium text-muted-foreground
                  underline-offset-4 hover:underline focus-visible:outline-none
                  focus-visible:ring-2 focus-visible:ring-ring`}
                href={transaction.explorer.href}
                target="_blank"
                rel="noopener noreferrer"
                title={transaction.explorer.title}
              >
                {transaction.explorer.label}<span aria-hidden="true"> ↗</span>
              </a>
            ) : null}
          </>
        ) : null}
        {action && actionError ? <p role="alert" className="text-sm text-destructive">{actionError}</p> : null}
      </MoneyModalBody>
      {item && action ? action.kind === "clear-order" ? (
        <DrawerFooter>
          <Button
            size="lg"
            variant="outline"
            className="h-11"
            disabled={actionBusy}
            onClick={() => onAction(item, action.kind)}
          >
            {action.label}
          </Button>
        </DrawerFooter>
      ) : (
        <MoneyModalFooter
          primaryLabel={action.label}
          onPrimary={() => onAction(item, action.kind)}
          primaryDisabled={actionBusy}
        />
      ) : null}
    </MoneyModal>
  );
}

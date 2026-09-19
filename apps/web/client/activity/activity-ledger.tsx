"use client";

import { useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { Banknote, CircleDollarSign, CreditCard, Landmark, WalletCards } from "lucide-react";
import { ActivityRow } from "@/components/finance-rows";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import {
  MoneyModal,
  MoneyModalBody,
  MoneyModalFooter,
  MoneyModalHeader,
} from "@/client/money-modal";

export const activityLedgerStatuses = [
  "waiting-customer",
  "waiting-provider",
  "waiting-chain",
  "waiting-home",
  "confirmed",
  "failed",
  "expired",
  "ambiguous",
  "reversed",
  "refunded",
] as const;

export type ActivityLedgerStatus = (typeof activityLedgerStatuses)[number];

export const activityLedgerNextActionKinds = [
  "resume",
  "resume-verification",
  "complete-payment",
  "retry",
  "start-again",
  "contact-support",
  "withdraw-returned-funds",
] as const;

export type ActivityLedgerNextActionKind = (typeof activityLedgerNextActionKinds)[number];

export const activityLedgerAllowedNextActions = {
  "waiting-customer": ["resume", "resume-verification", "complete-payment"],
  "waiting-provider": [],
  "waiting-chain": [],
  "waiting-home": [],
  confirmed: [],
  failed: ["retry", "contact-support"],
  expired: ["start-again"],
  ambiguous: ["contact-support"],
  reversed: ["withdraw-returned-funds"],
  refunded: [],
} as const satisfies Record<ActivityLedgerStatus, readonly ActivityLedgerNextActionKind[]>;

export const activityLedgerStatusMessageIds = {
  "waiting-customer": "activity.status.waiting_customer",
  "waiting-provider": "activity.status.waiting_provider",
  "waiting-chain": "activity.status.waiting_chain",
  "waiting-home": "activity.status.waiting_home",
  confirmed: "activity.status.confirmed",
  failed: "activity.status.failed",
  expired: "activity.status.expired",
  ambiguous: "activity.status.ambiguous",
  reversed: "activity.status.reversed",
  refunded: "activity.status.refunded",
} as const satisfies Record<ActivityLedgerStatus, string>;

export type ActivityLedgerStatusCopy = {
  label: string;
  description?: string;
};

export const activityLedgerStatusCopy = {
  "waiting-customer": {
    label: "Needs your attention",
    description: "Continue this activity to move it forward.",
  },
  "waiting-provider": {
    label: "Waiting for provider",
    description: "The provider is processing this activity. No action is needed.",
  },
  "waiting-chain": {
    label: "Pending on Base",
    description: "The transaction was submitted. Wait for confirmation before trying again.",
  },
  "waiting-home": {
    label: "Home is finalizing",
    description: "Home is checking the result. No action is needed.",
  },
  confirmed: {
    label: "Confirmed",
  },
  failed: {
    label: "Failed",
    description: "This activity did not complete.",
  },
  expired: {
    label: "Expired",
    description: "This activity expired before it completed.",
  },
  ambiguous: {
    label: "Check status",
    description: "Home could not confirm the outcome. Do not try again yet.",
  },
  reversed: {
    label: "Reversed",
    description: "The original activity was reversed.",
  },
  refunded: {
    label: "Refunded",
    description: "The money was returned after the original activity.",
  },
} as const satisfies Record<ActivityLedgerStatus, ActivityLedgerStatusCopy>;

export type ActivityLedgerNextAction = {
  kind: ActivityLedgerNextActionKind;
  label: string;
};

export type OnchainTransferDetail = {
  family: "onchain-transfer";
  network: string;
  from: string;
  to: string;
  transaction: string;
};

export type HomeActionDetail = {
  family: "home-action";
  operation: string;
  network: string;
  actionId: string;
  transaction?: string;
};

export type FundingOrderDetail = {
  family: "funding-order";
  provider: string;
  orderId: string;
  paymentMethod: string;
};

export type CashOutOrderDetail = {
  family: "cash-out-order";
  provider: string;
  orderId: string;
  payoutMethod: string;
};

export type CardActivityDetail = {
  family: "card";
  merchant: string;
  cardLabel: string;
  reference: string;
};

export type ActivityLedgerDetail =
  | OnchainTransferDetail
  | HomeActionDetail
  | FundingOrderDetail
  | CashOutOrderDetail
  | CardActivityDetail;

export type ActivityLedgerFamily = ActivityLedgerDetail["family"];

type ActivityLedgerItemBase = {
  /** Canonical source-owned identity. Presentation never synthesizes or rewrites it. */
  canonicalId: string;
  title: string;
  /** Already localized, exact amount. Never derived from a rounded display value. */
  exactAmount: string;
  occurredAt: string;
  occurredAtLabel: string;
  status: ActivityLedgerStatus;
  statusCopy?: ActivityLedgerStatusCopy;
  nextAction?: ActivityLedgerNextAction;
  /** Optional presentation evidence that multiple source records were correlated upstream. */
  correlatedSourceCount?: number;
};

export type ActivityLedgerItem = ActivityLedgerItemBase & (
  | { family: "onchain-transfer"; detail: OnchainTransferDetail }
  | { family: "home-action"; detail: HomeActionDetail }
  | { family: "funding-order"; detail: FundingOrderDetail }
  | { family: "cash-out-order"; detail: CashOutOrderDetail }
  | { family: "card"; detail: CardActivityDetail }
);

export type ActivitySourceFailure = {
  id: string;
  label: string;
};

type ActivityLedgerSharedProps = {
  items: readonly ActivityLedgerItem[];
  sourceFailures?: readonly ActivitySourceFailure[];
  defaultSelectedId?: string | null;
  onNextAction?: (item: ActivityLedgerItem, action: ActivityLedgerNextAction) => void;
  onRetrySources?: () => void;
  heading?: string;
};

type ActivityLedgerSelectionProps =
  | {
      selectedId: string | null;
      onSelectedChange: (canonicalId: string | null) => void;
    }
  | {
      selectedId?: undefined;
      onSelectedChange?: (canonicalId: string | null) => void;
    };

export type ActivityLedgerProps = ActivityLedgerSharedProps & ActivityLedgerSelectionProps;

export function isActivityLedgerNextActionAllowed(
  status: ActivityLedgerStatus,
  action: ActivityLedgerNextActionKind,
  family: ActivityLedgerFamily,
): boolean {
  if (!(activityLedgerAllowedNextActions[status] as readonly ActivityLedgerNextActionKind[]).includes(action)) {
    return false;
  }

  if (action === "resume-verification" || action === "complete-payment") {
    return family === "funding-order";
  }
  if (action === "withdraw-returned-funds") return family === "cash-out-order";
  return true;
}

export function ActivityLedger({
  items,
  sourceFailures = [],
  selectedId,
  defaultSelectedId = null,
  onSelectedChange,
  onNextAction,
  onRetrySources,
  heading = "Activity",
}: ActivityLedgerProps) {
  const [internalSelectedId, setInternalSelectedId] = useState(
    selectedId === undefined ? defaultSelectedId : selectedId,
  );
  const openerRef = useRef<HTMLElement | null>(null);
  const isControlled = selectedId !== undefined && onSelectedChange !== undefined;
  const activeId = isControlled ? selectedId : internalSelectedId;
  const selectedItem = items.find((item) => item.canonicalId === activeId) ?? null;

  function select(next: string | null) {
    if (activeId === next) return;
    if (!isControlled) setInternalSelectedId(next);
    onSelectedChange?.(next);
  }

  function closeDetails() {
    select(null);
  }

  return (
    <section aria-label={heading}>
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">{heading}</h2>
        </CardHeader>
        <CardContent inset="list">
          <div className="space-y-3">
            {sourceFailures.length > 0 ? (
              <Alert role="status">
                <AlertTitle>Some activity couldn&apos;t be loaded.</AlertTitle>
                <AlertDescription>
                  Unavailable: {sourceFailures.map((source) => source.label).join(", ")}. Available items are unchanged.
                </AlertDescription>
                {onRetrySources ? (
                  <AlertAction>
                    <Button size="sm" variant="secondary" onClick={onRetrySources}>Try again</Button>
                  </AlertAction>
                ) : null}
              </Alert>
            ) : null}
            {items.length === 0 && sourceFailures.length === 0 ? (
              <Empty className="items-start justify-start text-left">
                <EmptyHeader className="items-start">
                  <EmptyTitle>No activity yet</EmptyTitle>
                </EmptyHeader>
              </Empty>
            ) : items.length > 0 ? (
              <ol className="list-none space-y-1 p-0">
                {items.map((item) => {
                  const copy = item.statusCopy ?? activityLedgerStatusCopy[item.status];
                  return (
                    <ActivityRow
                      key={item.canonicalId}
                      icon={iconForFamily(item.family)}
                      label={item.title}
                      context={<><time dateTime={item.occurredAt}>{item.occurredAtLabel}</time><span aria-hidden="true"> · </span>{copy.label}</>}
                      contextTitle={`${item.occurredAtLabel} · ${copy.label}`}
                      value={item.exactAmount}
                      valueContext={item.correlatedSourceCount && item.correlatedSourceCount > 1 ? "Matched confirmation" : undefined}
                      onActivate={(event) => {
                        openerRef.current = event.currentTarget;
                        select(item.canonicalId);
                      }}
                      activateLabel={`View ${item.title} details`}
                    />
                  );
                })}
              </ol>
            ) : null}
          </div>
        </CardContent>
      </Card>
      <ActivityLedgerDetailSheet
        item={selectedItem}
        open={selectedItem !== null}
        finalFocusRef={openerRef}
        onBack={closeDetails}
        onClose={closeDetails}
        onNextAction={onNextAction}
      />
    </section>
  );
}

export function ActivityNeedsAttention({
  item,
  count = 1,
  onNextAction,
}: {
  item: ActivityLedgerItem;
  count?: number;
  onNextAction: (item: ActivityLedgerItem, action: ActivityLedgerNextAction) => void;
}) {
  const action = item.nextAction;
  if (
    item.status !== "waiting-customer" ||
    !action ||
    !isActivityLedgerNextActionAllowed(item.status, action.kind, item.family)
  ) return null;

  return (
    <Alert role="status">
      <AlertTitle>Needs your attention</AlertTitle>
      <AlertDescription>
        {count > 1 ? `${count} activities need you. ` : ""}{item.title}
      </AlertDescription>
      <AlertAction>
        <Button size="sm" variant="secondary" onClick={() => onNextAction(item, action)}>
          {action.label}
        </Button>
      </AlertAction>
    </Alert>
  );
}

export function ActivityLedgerDetailSheet({
  item,
  open,
  finalFocusRef,
  onBack,
  onClose,
  onNextAction,
}: {
  item: ActivityLedgerItem | null;
  open: boolean;
  finalFocusRef: RefObject<HTMLElement | null>;
  onBack: () => void;
  onClose: () => void;
  onNextAction?: (item: ActivityLedgerItem, action: ActivityLedgerNextAction) => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const statusDescription = item ? detailStatusDescription(item) : "Activity details";
  const detailAction = item?.nextAction && onNextAction && isActivityLedgerNextActionAllowed(item.status, item.nextAction.kind, item.family)
    ? { action: item.nextAction, handler: onNextAction, item }
    : null;
  const rows = item ? detailRows(item.detail) : [];

  return (
    <MoneyModal
      open={open}
      labelledBy={titleId}
      describedBy={descriptionId}
      finalFocusRef={finalFocusRef}
      onCancel={onClose}
      onClose={onClose}
    >
      <MoneyModalHeader
        title={item?.title ?? ""}
        titleId={titleId}
        onBack={onBack}
        onClose={onClose}
        closeLabel="Close activity details"
      />
      <MoneyModalBody hasFooter={detailAction !== null} className="pt-4">
        <div className="space-y-4">
          <div>
            <p className="text-2xl font-semibold tabular-nums">{item?.exactAmount}</p>
            <p id={descriptionId} className="mt-1 text-sm text-muted-foreground">
              {statusDescription}
            </p>
          </div>
          <Separator />
          <dl>
            {item ? (
              <DetailRow label="Date" value={item.occurredAtLabel} />
            ) : null}
            {rows.map((row) => <DetailRow key={row.label} label={row.label} value={row.value} />)}
          </dl>
        </div>
      </MoneyModalBody>
      {detailAction ? (
        <MoneyModalFooter
          primaryLabel={detailAction.action.label}
          onPrimary={() => detailAction.handler(detailAction.item, detailAction.action)}
        />
      ) : null}
    </MoneyModal>
  );
}

function detailStatusDescription(item: ActivityLedgerItem): string {
  const fallback: ActivityLedgerStatusCopy = activityLedgerStatusCopy[item.status];
  const copy: ActivityLedgerStatusCopy = item.statusCopy ?? fallback;
  const label = copy.label.trim() || fallback.label;
  const description = copy.description?.trim();

  if (!description) return label;
  return `${label}${/[.!?]$/.test(label) ? "" : "."} ${description}`;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="relative grid min-h-11 grid-cols-[minmax(6rem,0.65fr)_minmax(0,1.35fr)] items-center gap-3 text-sm after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-border last:after:hidden">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function detailRows(detail: ActivityLedgerDetail): { label: string; value: string }[] {
  switch (detail.family) {
    case "onchain-transfer":
      return [
        { label: "Network", value: detail.network },
        { label: "From", value: detail.from },
        { label: "To", value: detail.to },
        { label: "Transaction", value: detail.transaction },
      ];
    case "home-action":
      return [
        { label: "Operation", value: detail.operation },
        { label: "Network", value: detail.network },
        { label: "Action", value: detail.actionId },
        ...(detail.transaction ? [{ label: "Transaction", value: detail.transaction }] : []),
      ];
    case "funding-order":
      return [
        { label: "Provider", value: detail.provider },
        { label: "Payment method", value: detail.paymentMethod },
        { label: "Order", value: detail.orderId },
      ];
    case "cash-out-order":
      return [
        { label: "Provider", value: detail.provider },
        { label: "Payout method", value: detail.payoutMethod },
        { label: "Order", value: detail.orderId },
      ];
    case "card":
      return [
        { label: "Merchant", value: detail.merchant },
        { label: "Card", value: detail.cardLabel },
        { label: "Reference", value: detail.reference },
      ];
  }
}

function iconForFamily(family: ActivityLedgerDetail["family"]): ReactNode {
  if (family === "onchain-transfer") return <WalletCards className="size-4" />;
  if (family === "home-action") return <Landmark className="size-4" />;
  if (family === "funding-order") return <CircleDollarSign className="size-4" />;
  if (family === "cash-out-order") return <Banknote className="size-4" />;
  return <CreditCard className="size-4" />;
}

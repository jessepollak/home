"use client";

import { useId, useState, type ReactNode } from "react";
import {
  ArrowDownLeft,
  Banknote,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleQuestionMark,
  CircleX,
  Clock,
  CreditCard,
  HandCoins,
  LoaderCircle,
  PiggyBank,
  X,
} from "lucide-react";
import {
  MoneyModal,
  MoneyModalBody,
  MoneyModalFooter,
  MoneyModalHeader,
} from "@/client/money-modal";
import { ShimmerRows } from "@/client/home/panel-shared";
import { CopyableValue } from "@/components/copyable-value";
import { CurrencyMark, GlyphMark } from "@/components/currency-mark";
import { ActivityRow } from "@/components/finance-rows";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DrawerFooter } from "@/components/ui/drawer";
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ActivityUnavailable } from "../activity-panel";

export type ActivityLedgerStatus =
  | "waiting-customer"
  | "waiting-provider"
  | "waiting-chain"
  | "waiting-home"
  | "confirmed"
  | "failed"
  | "expired"
  | "ambiguous"
  | "reversed"
  | "refunded";
export type ActivityLedgerFamily =
  | "onchain-transfer"
  | "home-action"
  | "funding-order"
  | "cash-out-order"
  | "card";
export type ActivityLedgerNextActionKind =
  | "resume"
  | "resume-verification"
  | "complete-payment"
  | "retry"
  | "start-again"
  | "clear-order"
  | "withdraw-returned-funds";
type Transaction = {
  value: string;
  display: string;
  explorer?: { href: string; label: string; title?: string };
};
type Detail =
  | {
    family: "onchain-transfer";
    counterpartyLabel: string;
    counterparty: string;
    network: string;
    transaction?: Transaction;
  }
  | {
    family: "home-action";
    operation: string;
    from?: string;
    network: string;
    transaction?: Transaction;
  }
  | {
    family: "funding-order";
    provider: string;
    paymentMethod: string;
    orderId: string;
  }
  | {
    family: "cash-out-order";
    provider: string;
    payoutMethod: string;
    orderId: string;
  }
  | {
    family: "card";
    merchant: string;
    cardLabel: string;
    originalPurchase?: string;
    reference?: string;
  };
export type ActivityLedgerItem = {
  id: string;
  status: ActivityLedgerStatus;
  timestamp: string;
  updatedAt?: string;
  dateLabel: string;
  statusLabel?: string;
  title: string;
  amount: string;
  direction: "in" | "out" | "none";
  mark?:
    | { kind: "asset"; assetKey?: string; symbol: string }
    | { kind: "glyph"; glyph: "cash" | "borrow" | "card" | "savings" };
  ownerSentence?: { title: string; description?: string };
  steps?: Array<{
    status: "complete" | "current" | "upcoming" | "failed";
    title: string;
    time: string;
  }>;
  nextAction?: { kind: ActivityLedgerNextActionKind; label: string };
} & {
  [F in ActivityLedgerFamily]: {
    family: F;
    detail: Extract<Detail, { family: F }>;
  }
}[ActivityLedgerFamily];

const allowed: Record<ActivityLedgerStatus, readonly ActivityLedgerNextActionKind[]> = {
  "waiting-customer": ["resume", "resume-verification", "complete-payment"],
  "waiting-provider": [],
  "waiting-chain": [],
  "waiting-home": [],
  confirmed: [],
  failed: ["retry"],
  expired: ["start-again"],
  ambiguous: ["clear-order"],
  reversed: ["withdraw-returned-funds"],
  refunded: [],
};

export function isActivityLedgerNextActionAllowed(
  status: ActivityLedgerStatus,
  family: ActivityLedgerFamily,
  kind: ActivityLedgerNextActionKind,
): boolean {
  if (!allowed[status]?.includes(kind) || family === "card") return false;
  if (kind === "resume-verification" || kind === "complete-payment" || kind === "clear-order") {
    return family === "funding-order";
  }
  if (kind === "withdraw-returned-funds") return family === "cash-out-order";
  return true;
}

const statusWords: Record<ActivityLedgerStatus, string> = {
  "waiting-customer": "",
  "waiting-provider": "",
  "waiting-chain": "",
  "waiting-home": "",
  confirmed: "",
  failed: "Failed",
  expired: "Expired",
  ambiguous: "",
  reversed: "Reversed",
  refunded: "Refunded",
};
const ownerDefaults: Partial<Record<
  ActivityLedgerStatus,
  { title: string; description?: string }
>> = {
  "waiting-chain": { title: "Still sending", description: "No need to send it again." },
  ambiguous: {
    title: "We can't confirm this yet",
    description: "Don't try again until this updates.",
  },
};

function recordKey(item: ActivityLedgerItem): string {
  return `${item.family}:${item.id}`;
}

const lifecycleRank: Record<ActivityLedgerStatus, number> = {
  "waiting-customer": 0,
  "waiting-provider": 0,
  "waiting-chain": 0,
  "waiting-home": 0,
  ambiguous: 1,
  confirmed: 2,
  failed: 2,
  expired: 2,
  reversed: 3,
  refunded: 3,
};

function snapshotTime(item: ActivityLedgerItem): number {
  const time = item.updatedAt === undefined ? Number.NaN : Date.parse(item.updatedAt);
  return Number.isNaN(time) ? -Infinity : time;
}

function uniqueByRecord(items: readonly ActivityLedgerItem[]): ActivityLedgerItem[] {
  const indexByKey = new Map<string, number>();
  const unique: ActivityLedgerItem[] = [];
  for (const item of items) {
    const key = recordKey(item);
    const index = indexByKey.get(key);
    if (index === undefined) {
      indexByKey.set(key, unique.length);
      unique.push(item);
      continue;
    }
    const current = unique[index]!;
    const itemTime = snapshotTime(item);
    const currentTime = snapshotTime(current);
    if (itemTime > currentTime ||
      (itemTime === currentTime && lifecycleRank[item.status] > lifecycleRank[current.status])) {
      unique[index] = item;
    }
  }
  return unique;
}

function markFor(item: ActivityLedgerItem) {
  if (item.status === "failed") return <X className="size-4" />;
  if (item.status === "ambiguous") return <CircleQuestionMark className="size-4" />;
  if (item.mark?.kind === "asset") {
    return <CurrencyMark assetKey={item.mark.assetKey} symbol={item.mark.symbol} size="sm" />;
  }
  const Glyph = item.mark?.kind === "glyph"
    ? { cash: Banknote, borrow: HandCoins, card: CreditCard, savings: PiggyBank }[item.mark.glyph]
    : Circle;
  return <GlyphMark size="sm"><Glyph className="size-4" /></GlyphMark>;
}

function needsCustomer(item: ActivityLedgerItem): boolean {
  return (item.status === "waiting-customer" || item.status === "reversed") &&
    Boolean(item.nextAction && isActivityLedgerNextActionAllowed(
      item.status, item.family, item.nextAction.kind,
    ));
}

function isPending(item: ActivityLedgerItem): boolean {
  return needsCustomer(item) || [
    "waiting-customer", "waiting-provider", "waiting-chain", "waiting-home", "ambiguous",
  ].includes(item.status);
}

function LedgerRows({ items, labelledBy, attentionLabel, onOpen }: {
  items: readonly ActivityLedgerItem[];
  labelledBy?: string;
  attentionLabel: string;
  onOpen: (item: ActivityLedgerItem, opener: HTMLElement) => void;
}) {
  return (
    <ul aria-labelledby={labelledBy} className="list-none p-0">
      {items.map((item) => {
        const status = item.statusLabel ?? (
          item.status === "failed" && item.family === "card" ? "Declined" : statusWords[item.status]
        );
        const iconTone = item.status === "failed"
          ? "outlined" : item.status === "ambiguous" ? "neutral" : "mark";
        const valueTone = item.status === "confirmed" || item.status === "refunded"
          ? item.direction === "in" ? "success" : "default"
          : ["waiting-chain", "waiting-home"].includes(item.status) ? "default" : "muted";
        return (
          <ActivityRow
            key={recordKey(item)}
            icon={markFor(item)}
            iconTone={iconTone}
            label={item.title}
            context={
              <>
                <time dateTime={item.timestamp}>{item.dateLabel}</time>
                {status ? ` · ${status}` : null}
              </>
            }
            contextTitle={`${item.dateLabel}${status ? ` · ${status}` : ""}`}
            value={item.amount}
            valueTone={valueTone}
            onActivate={(opener) => onOpen(item, opener)}
            activateLabel={`View ${item.title} details`}
            attention={needsCustomer(item) ? attentionLabel : undefined}
            chevron
          />
        );
      })}
    </ul>
  );
}

export function ActivityLedger({
  items,
  sources = [],
  emptyAction,
  pendingLabel = "Pending",
  recentLabel = "Recent",
  attentionLabel = "Action needed",
  onOpen,
}: {
  items: readonly ActivityLedgerItem[];
  sources?: readonly {
    id: string;
    label: string;
    status: "ready" | "loading" | "error";
    onRetry: () => void;
  }[];
  emptyAction?: ReactNode;
  pendingLabel?: string;
  recentLabel?: string;
  attentionLabel?: string;
  onOpen: (item: ActivityLedgerItem, opener: HTMLElement) => void;
}) {
  const pendingId = useId();
  const recentId = useId();
  const unique = uniqueByRecord(items);
  const pending = [
    ...unique.filter(needsCustomer),
    ...unique.filter((item) => isPending(item) && !needsCustomer(item)),
  ];
  const recent = unique.filter((item) => !isPending(item));
  const errors = sources.filter((source) => source.status === "error");
  const loading = sources.some((source) => source.status === "loading");
  return (
    <section aria-label="Activity" className="space-y-3">
      {unique.length ? pending.length ? (
        <>
          <Card variant="flush">
            <CardContent inset="list">
              <div className="flex items-center justify-between gap-3 px-3 pt-3 pb-1 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                <h3 id={pendingId}>{pendingLabel}</h3>
              </div>
              <LedgerRows items={pending} labelledBy={pendingId} attentionLabel={attentionLabel} onOpen={onOpen} />
              {loading && !recent.length ? <ShimmerRows count={1} /> : null}
            </CardContent>
          </Card>
          {recent.length ? (
            <Card variant="flush">
              <CardContent inset="list">
                <div className="flex items-center justify-between gap-3 px-3 pt-3 pb-1 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                  <h3 id={recentId}>{recentLabel}</h3>
                </div>
                <LedgerRows items={recent} labelledBy={recentId} attentionLabel={attentionLabel} onOpen={onOpen} />
                {loading ? <ShimmerRows count={1} /> : null}
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : (
        <Card variant="flush">
          <CardContent inset="list">
            <LedgerRows items={recent} attentionLabel={attentionLabel} onOpen={onOpen} />
            {loading ? <ShimmerRows count={1} /> : null}
          </CardContent>
        </Card>
      ) : loading ? (
        <ShimmerRows count={4} />
      ) : errors.length === 0 ? (
        <Empty>
          <EmptyHeader><EmptyTitle>No activity yet</EmptyTitle></EmptyHeader>
          {emptyAction ? <EmptyContent>{emptyAction}</EmptyContent> : null}
        </Empty>
      ) : null}
      <span role="status" className="sr-only">{loading ? "Loading recent activity…" : ""}</span>
      {errors.map((source) => (
        <ActivityUnavailable
          key={source.id}
          message={`${source.label} unavailable`}
          onReload={source.onRetry}
          reloadLabel={`Reload ${source.label}`}
        />
      ))}
    </section>
  );
}

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

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      className={`grid min-h-11 grid-cols-[minmax(5rem,1fr)_minmax(0,1.4fr)]
        items-center gap-3 px-3 text-sm`}
    >
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right wrap-anywhere">{children}</dd>
    </div>
  );
}

export function ActivityLedgerDetailSheet({ item, open, immediate = false, onDismiss, onClosed, onAction }: {
  item: ActivityLedgerItem | null;
  open: boolean;
  onDismiss: () => void;
  immediate?: boolean;
  onClosed?: () => void;
  onAction: (item: ActivityLedgerItem, kind: ActivityLedgerNextActionKind) => void;
}) {
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
      facts.push(["Date", <time key="date" dateTime={item.timestamp}>{item.dateLabel}</time>]);
    }
    if (item.family === "onchain-transfer") {
      facts.push(
        [item.detail.counterpartyLabel, item.detail.counterparty],
        ["Network", item.detail.network],
      );
      transaction = item.detail.transaction;
    } else if (item.family === "home-action") {
      if (item.detail.operation !== item.title) facts.push(["Operation", item.detail.operation]);
      if (item.detail.from) facts.push(["From", item.detail.from]);
      facts.push(["Network", item.detail.network]);
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
        onClose={onDismiss}
      />
      <MoneyModalBody hasFooter={Boolean(action)} className="gap-4 pt-4">
        {item ? (
          <>
            <div className="flex flex-col items-center gap-2 py-3">
              <p className={`text-4xl font-semibold tabular-nums ${
                item.direction === "in" &&
                (item.status === "confirmed" || item.status === "refunded")
                  ? "text-market-gain" : ""
              }`}>
                {item.amount}
              </p>
              {statusBadge(item)}
            </div>
            {owner ? (
              <Alert variant={item.status === "failed" ? "destructive" : "default"}>
                <StatusIcon aria-hidden="true" />
                <AlertTitle>{owner.title}</AlertTitle>
                {owner.description ? (
                  <AlertDescription>{owner.description}</AlertDescription>
                ) : null}
              </Alert>
            ) : null}
            {(item.family === "funding-order" || item.family === "cash-out-order") &&
              item.steps?.length ? (
              <Card>
                <CardContent>
                  <ol className="space-y-3">
                    {item.steps.map((step, index) => {
                      const StepIcon = {
                        complete: CircleCheck,
                        current: LoaderCircle,
                        upcoming: Circle,
                        failed: CircleX,
                      }[step.status];
                      return (
                        <li key={`${index}:${step.title}`} className="flex items-start gap-3">
                          <StepIcon
                            aria-hidden="true"
                            className={`mt-1 size-4 shrink-0 ${step.status === "failed"
                              ? "text-destructive" : step.status === "upcoming"
                                ? "text-muted-foreground" : ""}`}
                          />
                          <div className="min-w-0">
                            <p>{step.title}</p>
                            {step.time ? (
                              <p className="text-sm text-muted-foreground">{step.time}</p>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </CardContent>
              </Card>
            ) : null}
            <Card variant="flush">
              <CardContent inset="list">
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
      </MoneyModalBody>
      {item && action ? action.kind === "clear-order" ? (
        <DrawerFooter>
          <Button
            size="lg"
            variant="outline"
            className="h-11"
            onClick={() => onAction(item, action.kind)}
          >
            {action.label}
          </Button>
        </DrawerFooter>
      ) : (
        <MoneyModalFooter
          primaryLabel={action.label}
          onPrimary={() => onAction(item, action.kind)}
        />
      ) : null}
    </MoneyModal>
  );
}

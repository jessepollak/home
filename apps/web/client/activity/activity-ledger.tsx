"use client";

import { useId, type ReactNode } from "react";
import {
  Banknote,
  Circle,
  CircleQuestionMark,
  CreditCard,
  HandCoins,
  PiggyBank,
  X,
} from "lucide-react";
import { CurrencyMark, GlyphMark } from "@/components/currency-mark";
import { ActivityRow } from "@/components/finance-rows";
import { MoneyTicker } from "@/components/money-ticker";
import { Card, CardContent } from "@/components/ui/card";

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
  | "withdraw-returned-funds"
  | "cancel-cash-out";
export type Transaction = {
  value: string;
  display: string;
  explorer?: { href: string; label: string; title?: string };
};
export type ActivityLedgerDetail =
  | {
    family: "onchain-transfer";
    counterpartyLabel: string;
    counterparty: string;
    network: string;
    transaction?: Transaction;
    facts?: readonly { label: string; value: string }[];
  }
  | {
    family: "home-action";
    operation: string;
    from?: string;
    network: string;
    transaction?: Transaction;
    facts?: readonly { label: string; value: string }[];
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
  fullDateLabel?: string;
  statusLabel?: string;
  title: string;
  amount: string;
  amountContext?: string;
  detailAmount?: string;
  activateLabel?: string;
  direction: "in" | "out" | "none";
  mark?:
    | { kind: "asset"; assetKey?: string; symbol: string; imageUrl?: string | null }
    | { kind: "glyph"; glyph: "cash" | "borrow" | "card" | "savings" };
  ownerSentence?: { title: string; description?: string };
  steps?: Array<{
    status: "complete" | "current" | "upcoming" | "failed";
    title: string;
    time?: string;
  }>;
  nextAction?: { kind: ActivityLedgerNextActionKind; label: string };
} & {
  [F in ActivityLedgerFamily]: {
    family: F;
    detail: Extract<ActivityLedgerDetail, { family: F }>;
  }
}[ActivityLedgerFamily];

const allowed: Record<ActivityLedgerStatus, readonly ActivityLedgerNextActionKind[]> = {
  "waiting-customer": ["resume", "resume-verification", "complete-payment"],
  "waiting-provider": ["cancel-cash-out"],
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
  if (kind === "cancel-cash-out") return family === "cash-out-order" || family === "home-action";
  return true;
}

export const statusWords: Record<ActivityLedgerStatus, string> = {
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
export const ownerDefaults: Partial<Record<
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
    return <CurrencyMark assetKey={item.mark.assetKey} symbol={item.mark.symbol} src={item.mark.imageUrl} size="sm" />;
  }
  const Glyph = item.mark?.kind === "glyph"
    ? { cash: Banknote, borrow: HandCoins, card: CreditCard, savings: PiggyBank }[item.mark.glyph]
    : Circle;
  return <GlyphMark size="sm"><Glyph className="size-4" /></GlyphMark>;
}

export function needsCustomer(item: ActivityLedgerItem): boolean {
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
        const status = statusWords[item.status]
          ? item.statusLabel ?? (item.status === "failed" && item.family === "card"
            ? "Declined" : statusWords[item.status])
          : "";
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
                <time dateTime={item.timestamp} aria-label={item.fullDateLabel}>{item.dateLabel}</time>
                {status ? ` · ${status}` : null}
              </>
            }
            contextTitle={`${item.fullDateLabel ?? item.dateLabel}${status ? ` · ${status}` : ""}`}
            value={item.amount ? <MoneyTicker value={item.amount} /> : undefined}
            valueContext={item.amountContext}
            valueTone={valueTone}
            onActivate={(opener) => onOpen(item, opener)}
            activateLabel={item.activateLabel ?? `View ${item.title} details`}
            attention={needsCustomer(item) ? attentionLabel : undefined}
            chevron
          />
        );
      })}
    </ul>
  );
}

export type ActivityLedgerProps = {
  items: readonly ActivityLedgerItem[];
  layout?: "page" | "feed";
  pendingLabel?: string;
  recentLabel?: string;
  attentionLabel?: string;
  footer?: ReactNode;
  onOpen: (item: ActivityLedgerItem, opener: HTMLElement) => void;
};

function GroupHeader({ id, label }: { id: string; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 pt-3 pb-1 text-xs font-medium tracking-wider text-muted-foreground uppercase">
      <h3 id={id}>{label}</h3>
    </div>
  );
}

export function ActivityLedger({
  items,
  layout = "page",
  pendingLabel = "Pending",
  recentLabel = "Recent",
  attentionLabel = "Action needed",
  footer,
  onOpen,
}: ActivityLedgerProps) {
  const pendingId = useId();
  const recentId = useId();
  const unique = uniqueByRecord(items);
  if (!unique.length) return footer ?? null;
  const pending = [
    ...unique.filter(needsCustomer),
    ...unique.filter((item) => isPending(item) && !needsCustomer(item)),
  ];
  const recent = unique.filter((item) => !isPending(item));
  const footerSlot = footer ? <div className="pt-2 pb-3">{footer}</div> : null;
  if (layout === "feed") {
    return (
      <div className="space-y-3">
        {pending.length ? (
          <div>
            <GroupHeader id={pendingId} label={pendingLabel} />
            <LedgerRows items={pending} labelledBy={pendingId} attentionLabel={attentionLabel} onOpen={onOpen} />
          </div>
        ) : null}
        {recent.length ? (
          <div>
            {pending.length ? <GroupHeader id={recentId} label={recentLabel} /> : null}
            <LedgerRows items={recent} labelledBy={pending.length ? recentId : undefined}
              attentionLabel={attentionLabel} onOpen={onOpen} />
          </div>
        ) : null}
        {footerSlot}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {pending.length ? (
        <Card variant="flush">
          <CardContent inset="list">
            <GroupHeader id={pendingId} label={pendingLabel} />
            <LedgerRows items={pending} labelledBy={pendingId} attentionLabel={attentionLabel} onOpen={onOpen} />
            {!recent.length ? footerSlot : null}
          </CardContent>
        </Card>
      ) : null}
      {recent.length ? (
        <Card variant="flush">
          <CardContent inset="list">
            {pending.length ? <GroupHeader id={recentId} label={recentLabel} /> : null}
            <LedgerRows items={recent} labelledBy={pending.length ? recentId : undefined}
              attentionLabel={attentionLabel} onOpen={onOpen} />
            {footerSlot}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}


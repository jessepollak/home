"use client";

import { memo, useCallback, useId, useMemo, useState, type HTMLAttributes, type ReactNode, type Ref } from "react";
import { VirtualActivityList, type ActivityListHandle, type ActivityVirtualRow } from "./virtual-activity-list";
import {
  Banknote,
  Circle,
  CircleQuestionMark,
  CreditCard,
  HandCoins,
  PiggyBank,
  X,
} from "lucide-react";
import { CurrencyMark, CurrencyMarkStack, GlyphMark } from "@/components/currency-mark";
import { ActivityRow } from "@/components/finance-rows";
import { assignTransferRunKeys } from "./activity-groups";
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
  | "cancel-order"
  | "withdraw-returned-funds"
  | "cancel-cash-out"
  | "unlock-card"
  | "add-money";
export type Transaction = {
  value: string;
  display: string;
  explorer?: { href: string; label: string; title?: string };
};
export type ActivityLedgerFact = { label: string; value: string; kind?: "address" };

export type ActivityLedgerDetail =
  | {
    family: "onchain-transfer";
    counterpartyLabel: string;
    counterparty: string;
    network: string;
    transaction?: Transaction;
    facts?: readonly ActivityLedgerFact[];
  }
  | {
    family: "home-action";
    operation: string;
    from?: string;
    network: string;
    transaction?: Transaction;
    facts?: readonly ActivityLedgerFact[];
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
    facts?: readonly { label: string; value: string }[];
  }
  | {
    family: "card";
    merchant: string;
    cardLabel: string;
    originalPurchase?: string;
    reference?: string;
  };
export type ActivityLedgerAsset = {
  assetKey: string;
  name: string;
  symbol: string;
  imageUrl?: string | null;
  openable: boolean;
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
  detailAmountParts?: { amount: string; symbol: string };
  detailValue?: string;
  detailAsset?: ActivityLedgerAsset;
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
  secondaryAction?: { kind: ActivityLedgerNextActionKind; label: string };
} & {
  [F in ActivityLedgerFamily]: {
    family: F;
    detail: Extract<ActivityLedgerDetail, { family: F }>;
  }
}[ActivityLedgerFamily];

export type ActivityLedgerGroup = {
  kind: "group";
  id: string;
  title: string;
  countLabel: string;
  count: number;
  newestTimestamp: string;
  oldestTimestamp: string;
  rangeLabel: string;
  fullRangeLabel: string;
  amount: string;
  amountContext?: string;
  direction: "in";
  mark: Extract<ActivityLedgerItem["mark"], { kind: "asset" }>;
  toggleLabel: string;
  children: readonly ActivityLedgerItem[];
};
export type ActivityLedgerEntry = ActivityLedgerItem | ActivityLedgerGroup;
export function isActivityLedgerGroup(entry: ActivityLedgerEntry): entry is ActivityLedgerGroup {
  return "kind" in entry && entry.kind === "group";
}

const allowed: Record<ActivityLedgerStatus, readonly ActivityLedgerNextActionKind[]> = {
  "waiting-customer": ["resume", "resume-verification", "complete-payment", "cancel-order"],
  "waiting-provider": ["cancel-cash-out"],
  "waiting-chain": [],
  "waiting-home": [],
  confirmed: [],
  failed: ["retry", "unlock-card", "add-money"],
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
  if (!allowed[status]?.includes(kind)) return false;
  if (kind === "unlock-card" || kind === "add-money") return family === "card";
  if (family === "card") return false;
  if (kind === "resume-verification" || kind === "complete-payment" || kind === "clear-order" || kind === "cancel-order") {
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

export function uniqueActivityLedgerItems(items: readonly ActivityLedgerItem[]): ActivityLedgerItem[];
export function uniqueActivityLedgerItems<T>(entries: readonly T[], itemOf: (entry: T) => ActivityLedgerItem): T[];
export function uniqueActivityLedgerItems<T>(
  entries: readonly T[],
  itemOf: (entry: T) => ActivityLedgerItem = (entry) => entry as ActivityLedgerItem,
): T[] {
  const indexByKey = new Map<string, number>();
  const unique: T[] = [];
  for (const entry of entries) {
    const item = itemOf(entry);
    const key = recordKey(item);
    const index = indexByKey.get(key);
    if (index === undefined) {
      indexByKey.set(key, unique.length);
      unique.push(entry);
      continue;
    }
    const current = itemOf(unique[index]!);
    const itemTime = snapshotTime(item);
    const currentTime = snapshotTime(current);
    if (itemTime > currentTime ||
      (itemTime === currentTime && lifecycleRank[item.status] > lifecycleRank[current.status])) {
      unique[index] = entry;
    }
  }
  return unique;
}

function markFor(item: { status?: ActivityLedgerStatus; mark?: ActivityLedgerItem["mark"] }) {
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

type LedgerItemRowProps = {
  item: ActivityLedgerItem;
  attentionLabel: string;
  onOpen: (item: ActivityLedgerItem, opener: HTMLElement) => void;
  liProps?: HTMLAttributes<HTMLLIElement> & { ref?: (element: HTMLLIElement | null) => void };
  child?: boolean;
};

const LedgerItemRow = memo(function LedgerItemRow({ item, attentionLabel, onOpen, liProps, child }: LedgerItemRowProps) {
  const status = item.family === "card" ? item.statusLabel ?? (item.status === "failed" ? "Declined" : "") : statusWords[item.status]
    ? item.statusLabel ?? statusWords[item.status] : "";
  const iconTone = item.status === "failed"
    ? "outlined" : item.status === "ambiguous" ? "neutral" : "mark";
  const valueTone = item.status === "confirmed" || item.status === "refunded"
    ? item.direction === "in" ? "success" : "default"
    : ["waiting-chain", "waiting-home"].includes(item.status) ? "default" : "muted";
  return (
    <ActivityRow
      liProps={child ? { ...liProps, className: "ps-4" } : liProps}
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
      value={item.amount ? <MoneyTicker value={item.amount} staticUntilChange /> : undefined}
      valueContext={item.amountContext}
      valueContextTitle={item.amountContext}
      valueTone={valueTone}
      onActivate={(opener) => onOpen(item, opener)}
      activateLabel={item.activateLabel ?? `View ${item.title} details`}
      attention={needsCustomer(item) ? attentionLabel : undefined}
      chevron
    />
  );
});

function LedgerRows({ items, labelledBy, attentionLabel, onOpen }: {
  items: readonly ActivityLedgerItem[];
  labelledBy?: string;
  attentionLabel: string;
  onOpen: (item: ActivityLedgerItem, opener: HTMLElement) => void;
}) {
  return (
    <ul aria-labelledby={labelledBy} className="list-none p-0">
      {items.map((item) => <LedgerItemRow key={recordKey(item)} item={item} attentionLabel={attentionLabel} onOpen={onOpen} />)}
    </ul>
  );
}

const RecentRow = memo(function RecentRow({ row, attentionLabel, onOpen, onToggle, liProps }: {
  row: ActivityVirtualRow;
  attentionLabel: string;
  onOpen: (item: ActivityLedgerItem, opener: HTMLElement) => void;
  onToggle: (children: readonly ActivityLedgerItem[], expanded: boolean) => void;
  liProps?: HTMLAttributes<HTMLLIElement> & { ref?: (element: HTMLLIElement | null) => void };
}) {
  if ("item" in row) return <LedgerItemRow item={row.item} child={row.child} liProps={liProps}
    attentionLabel={attentionLabel} onOpen={onOpen} />;
  const entry = row.group;
  return (
    <ActivityRow
      liProps={liProps}
      icon={<CurrencyMarkStack assetKey={entry.mark.assetKey} symbol={entry.mark.symbol} src={entry.mark.imageUrl} />}
      iconTone="stack"
      label={entry.title}
      labelSuffix={<span aria-hidden="true">×{entry.count}</span>}
      context={<><time dateTime={entry.oldestTimestamp} aria-hidden="true">{entry.rangeLabel}</time><span className="sr-only">{entry.fullRangeLabel}</span></>}
      contextTitle={entry.fullRangeLabel}
      value={<MoneyTicker value={entry.amount} staticUntilChange />}
      valueContext={entry.amountContext}
      valueContextTitle={entry.amountContext}
      valueTone="success"
      onActivate={() => onToggle(entry.children, row.expanded)}
      activateLabel={entry.toggleLabel}
      disclosure={{ expanded: row.expanded, controls: row.controls }}
    />
  );
});

export type ActivityLedgerProps = {
  items: readonly ActivityLedgerEntry[];
  layout?: "page" | "feed";
  pendingLabel?: string;
  recentLabel?: string;
  attentionLabel?: string;
  footer?: ReactNode;
  onOpen: (item: ActivityLedgerItem, opener: HTMLElement) => void;
  recentRef?: Ref<ActivityListHandle>;
  exhausted?: boolean;
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
  recentRef,
  exhausted = true,
}: ActivityLedgerProps) {
  const pendingId = useId();
  const recentId = useId();
  const recentListId = useId();
  const [expandedChildren, setExpandedChildren] = useState<ReadonlySet<string>>(() => new Set());
  const [previousRunKeys, setPreviousRunKeys] = useState<ReadonlyMap<string, string>>(() => new Map());
  const assigned = useMemo(() => assignTransferRunKeys(
    items.filter(isActivityLedgerGroup).map((run) => run.children.map((child) => child.id)), previousRunKeys,
  ), [items, previousRunKeys]);
  if (assigned.byChild.size !== previousRunKeys.size ||
    [...assigned.byChild].some(([child, key]) => previousRunKeys.get(child) !== key)) {
    setPreviousRunKeys(assigned.byChild);
  }
  const toggleRun = useCallback((children: readonly ActivityLedgerItem[], expanded: boolean) => {
    setExpandedChildren((previous) => {
      const next = new Set(previous);
      for (const child of children) {
        if (expanded) next.delete(child.id);
        else next.add(child.id);
      }
      return next;
    });
  }, []);
  const unique = useMemo(() => {
    const singles = uniqueActivityLedgerItems(items.filter((entry): entry is ActivityLedgerItem => !isActivityLedgerGroup(entry)));
    const latest = new Map(singles.map((item) => [recordKey(item), item]));
    return items.flatMap((entry): ActivityLedgerEntry[] => {
      if (isActivityLedgerGroup(entry)) return [entry];
      const key = recordKey(entry);
      const winner = latest.get(key);
      if (!winner) return [];
      latest.delete(key);
      return [winner];
    });
  }, [items]);
  const pending = useMemo(() => [
    ...unique.filter((entry): entry is ActivityLedgerItem => !isActivityLedgerGroup(entry) && needsCustomer(entry)),
    ...unique.filter((entry): entry is ActivityLedgerItem => !isActivityLedgerGroup(entry) && isPending(entry) && !needsCustomer(entry)),
  ], [unique]);
  const recent = useMemo(() => unique.filter((entry) => isActivityLedgerGroup(entry) || !isPending(entry)), [unique]);
  const rows = useMemo(() => recent.flatMap((entry): ActivityVirtualRow[] => {
    if (!isActivityLedgerGroup(entry)) return [{ key: recordKey(entry), item: entry }];
    const key = assigned.byChild.get(entry.children[0]!.id) ?? entry.id;
    const expanded = entry.children.some((child) => expandedChildren.has(child.id));
    return [{ key, group: entry, expanded, controls: expanded ? recentListId : undefined },
    ...(expanded ? entry.children.map((child) => ({
      key: recordKey(child), item: child, child: true,
    })) : [])];
  }), [recent, assigned.byChild, expandedChildren, recentListId]);
  if (!unique.length) return footer ?? null;
  const footerSlot = footer ? <div className="py-1">{footer}</div> : null;
  if (layout === "feed") {
    return (
      <div className="space-y-3" style={{ overflowAnchor: "none" }}>
        {pending.length ? (
          <div key="pending">
            <GroupHeader id={pendingId} label={pendingLabel} />
            <LedgerRows items={pending} labelledBy={pendingId} attentionLabel={attentionLabel} onOpen={onOpen} />
          </div>
        ) : null}
        {recent.length ? (
          <div key="recent">
            {pending.length ? <GroupHeader id={recentId} label={recentLabel} /> : null}
            <VirtualActivityList ref={recentRef} id={recentListId} items={rows} labelledBy={pending.length ? recentId : undefined}
              exhausted={exhausted} attentionLabel={attentionLabel} onOpen={onOpen} onToggle={toggleRun} Row={RecentRow} />
          </div>
        ) : null}
        {footerSlot}
      </div>
    );
  }
  return (
    <div className="space-y-3 [--mark-stack-surface:var(--card)]" style={{ overflowAnchor: "none" }}>
      {pending.length ? (
        <Card key="pending" variant="flush">
          <CardContent inset="list">
            <GroupHeader id={pendingId} label={pendingLabel} />
            <LedgerRows items={pending} labelledBy={pendingId} attentionLabel={attentionLabel} onOpen={onOpen} />
            {!recent.length ? footerSlot : null}
          </CardContent>
        </Card>
      ) : null}
      {recent.length ? (
        <Card key="recent" variant="flush">
          <CardContent inset="list">
            {pending.length ? <GroupHeader id={recentId} label={recentLabel} /> : null}
            <VirtualActivityList ref={recentRef} id={recentListId} items={rows} labelledBy={pending.length ? recentId : undefined}
              exhausted={exhausted} attentionLabel={attentionLabel} onOpen={onOpen} onToggle={toggleRun} Row={RecentRow} />
            {footerSlot}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

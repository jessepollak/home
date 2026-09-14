"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, CircleQuestionMark, X } from "lucide-react";
import { MoneyTicker } from "@/components/money-ticker";
import { ActivityRow } from "@/components/finance-rows";
import { TransactionDetailsModal } from "@/components/transaction-details";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import {
  dedupeRecentMoneyActions,
  parseRecentMoneyActions,
  type RecentMoneyActionOperation,
} from "@/shared/actions/contracts/list";
export type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import {
  formatPresentationDate,
  formatPresentationTokenAmount,
} from "@/shared/formatting";
import { labelForOperationStatus, presentOperationDetails, primaryOperationAmount } from "./operation-details";
import { ownerQueryKey, ownerQueryMeta, useHomeQuery } from "@/client/query/query-client";
import { activityOwnerKey } from "@/client/activity/use-activity";

export type FetchRecentMoneyActions = (signal?: AbortSignal) => Promise<unknown>;

export function RecentMoneyActions({
  session,
  fetchOperations,
  excludeTransactionHashes = [],
  embedded = false,
  showUnavailableNotice = true,
  onVisibleCountChange,
  limit,
}: {
  session: VerifiedAccountSession | null;
  fetchOperations: FetchRecentMoneyActions;
  excludeTransactionHashes?: Iterable<string>;
  embedded?: boolean;
  showUnavailableNotice?: boolean;
  onVisibleCountChange?: (count: number) => void;
  limit?: number;
}) {
  const ownerKey = session?.smartAccount ? activityOwnerKey(session) : null;
  const [selected, setSelected] = useState<RecentMoneyActionOperation | null>(null);
  const actions = useHomeQuery({
    queryKey: ownerKey ? ownerQueryKey(ownerKey, "actions") : ["unauthenticated", "actions-disabled"],
    enabled: ownerKey !== null,
    staleTime: 10_000,
    retry: false,
    refetchOnWindowFocus: false,
    meta: ownerKey ? ownerQueryMeta(ownerKey, "owner") : undefined,
    queryFn: ({ signal }) => fetchOperations(signal),
    select: (value) => {
      if (!session?.smartAccount) throw new Error("Actions are unavailable.");
      return parseRecentMoneyActions(value, session);
    },
  });
  const excluded = new Set(Array.from(excludeTransactionHashes, (hash) => hash.toLowerCase()));
  const allOperations = dedupeRecentMoneyActions(actions.data ?? [], excluded);
  const operations = limit === undefined ? allOperations : allOperations.slice(0, limit);
  const unavailable = actions.isError;
  const visibleCount = operations.length + (unavailable && showUnavailableNotice ? 1 : 0);
  useEffect(() => onVisibleCountChange?.(visibleCount), [onVisibleCountChange, visibleCount]);
  if (operations.length === 0 && (!unavailable || !showUnavailableNotice)) return null;

  const rows = unavailable ? (
    <p role="status" className="text-sm text-muted-foreground">
      Recorded Home actions are unavailable. Onchain transfers are still shown.
    </p>
  ) : (
    <ol className="list-none p-0">
      {operations.map((operation) => (
        <OperationRow
          key={operation.action.id}
          operation={operation}
          onActivate={() => setSelected(operation)}
        />
      ))}
    </ol>
  );
  const modal = (
    <TransactionDetailsModal
      open={selected !== null}
      titleId="home-operation-details-title"
      details={selected ? presentOperationDetails(selected) : null}
      onClose={() => setSelected(null)}
    />
  );

  if (embedded) return <>{rows}{modal}</>;

  return (
    <section className="space-y-3" aria-labelledby="home-operations-title">
      <h3 id="home-operations-title" className="text-lg font-semibold">Home actions</h3>
      {rows}
      {modal}
    </section>
  );
}

function OperationRow({ operation, onActivate }: { operation: RecentMoneyActionOperation; onActivate: () => void }) {
  const amount = primaryOperationAmount(operation);
  const status = labelForOperationStatus(operation.status);
  const date = formatPresentationDate(operation.updatedAt, { style: "activity-short" });
  const value = amount ? `${amount.direction === "spend" ? "−" : "+"}${amount.estimated ? "~" : ""}${formatPresentationTokenAmount(amount.amountBaseUnits, amount.decimals, amount.symbol, { cashCurrency: amount.symbol === "USDC" ? "USD" : null })}` : null;
  const icon = operation.status === "failed"
    ? <X className="size-4" />
    : operation.status === "unknown"
        ? <CircleQuestionMark className="size-4" />
        : amount?.direction === "receive"
          ? <ArrowDown className="size-4" />
          : <ArrowUp className="size-4" />;
  return <ActivityRow icon={icon} iconTone={operation.status === "failed" ? "outlined" : amount?.direction === "receive" ? "incoming" : "outgoing"} label={operation.action.title} context={<><time dateTime={operation.updatedAt}>{date}</time> · {status}</>} value={value ? <MoneyTicker value={value} /> : status} valueTone={operation.status === "failed" ? "error" : operation.status === "unknown" ? "muted" : "default"} onActivate={onActivate} activateLabel={`View ${operation.action.title} transaction details`} />;
}


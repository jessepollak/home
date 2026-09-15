"use client";

import { useEffect, useState } from "react";
import { TransactionDetailsModal } from "@/components/transaction-details";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import {
  dedupeRecentMoneyActions,
  parseRecentMoneyActions,
  type RecentMoneyActionOperation,
} from "@/shared/actions/contracts/list";
export type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import { presentOperationDetails } from "./operation-details";
import { OperationActivityRow } from "./operation-row";
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
        <OperationActivityRow
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


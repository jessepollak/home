"use client";

import { Toaster } from "@/components/ui/toast";
import { useCallback, useEffect, useRef } from "react";
import { homeToastDurationMs, useHomeToast, type HomeToastRole, type HomeToastTone } from "./use-home-toast";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { formatAddress, formatFiatAmount, formatPresentationTokenAmount } from "@/shared/formatting";
import { ownerQueryKey, ownerQueryMeta, useHomeQuery } from "@/client/query/query-client";
import { activityOwnerKey } from "@/client/activity/use-activity";
import { actionFailureEvent } from "./action-toast-events";

const defaultDismissAfterMs = homeToastDurationMs;
type ToastAction = {
  id: string;
  kind: string;
  status: "pending" | "confirmed";
  summary: {
    metadata?: { product: "borrow"; operation: string } | { product: "trade"; direction: "buy" | "sell" };
    amounts: Array<{
      symbol: string;
      decimals: number;
      amountBaseUnits: string;
      direction: "spend" | "receive";
      estimated?: boolean;
      maximum?: boolean;
    }>;
    warnings: string[];
  };
};

export function ActionToasts({ session, fetchOperations, dismissAfterMs = defaultDismissAfterMs }: {
  session: VerifiedAccountSession | null;
  fetchOperations: (signal?: AbortSignal) => Promise<unknown>;
  dismissAfterMs?: number;
}) {
  const ownerKey = session?.smartAccount ? activityOwnerKey(session) : null;
  const seenStatuses = useRef(new Map<string, ToastAction["status"]>());
  const seededOwners = useRef(new Set<string>());
  const { add, closeAll } = useHomeToast(ownerKey);
  const actions = useHomeQuery({
    queryKey: ownerKey ? ownerQueryKey(ownerKey, "actions") : ["unauthenticated", "action-toasts-disabled"],
    enabled: ownerKey !== null,
    staleTime: 10_000,
    retry: false,
    refetchOnWindowFocus: false,
    meta: ownerKey ? ownerQueryMeta(ownerKey, "owner") : undefined,
    queryFn: ({ signal }) => fetchOperations(signal),
    select: parseToastActions,
  });
  const addToast = useCallback((message: string, tone: HomeToastTone = "neutral", role: HomeToastRole = "status") => {
    add({ message, tone, role, duration: dismissAfterMs });
  }, [add, dismissAfterMs]);

  useEffect(() => () => closeAll(), [closeAll]);
  useEffect(() => {
    if (!actions.data || !ownerKey) return;
    if (!seededOwners.current.has(ownerKey)) {
      for (const action of actions.data) seenStatuses.current.set(`${ownerKey}\u0000${action.id}`, action.status);
      seededOwners.current.add(ownerKey);
      return;
    }
    for (const action of actions.data) {
      const statusKey = `${ownerKey}\u0000${action.id}`;
      const previous = seenStatuses.current.get(statusKey);
      if (action.status === "pending" && previous === undefined) {
        const message = actionToastMessage(action, "pending");
        if (message) addToast(message);
      } else if (action.status === "confirmed" && previous === "pending") {
        const message = actionToastMessage(action, "confirmed");
        if (message) addToast(message, "success");
      }
      seenStatuses.current.set(statusKey, action.status);
    }
  }, [actions.data, addToast, ownerKey]);
  useEffect(() => {
    const onFailure = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!isRecord(detail) || typeof detail.kind !== "string" || typeof detail.reason !== "string") return;
      addToast(`${failedVerb(detail.kind)} failed: ${detail.reason}`, "error", "alert");
    };
    window.addEventListener(actionFailureEvent, onFailure);
    return () => window.removeEventListener(actionFailureEvent, onFailure);
  }, [addToast]);
  return <Toaster />;
}

function parseToastActions(value: unknown): ToastAction[] {
  if (!isRecord(value) || !Array.isArray(value.actions)) return [];
  return value.actions.flatMap((item): ToastAction[] => {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.kind !== "string" ||
      (item.status !== "pending" && item.status !== "confirmed") || !isRecord(item.summary) ||
      !Array.isArray(item.summary.amounts) || !Array.isArray(item.summary.warnings)) return [];
    const amounts = item.summary.amounts.flatMap((amount) => {
      if (!isRecord(amount) || typeof amount.symbol !== "string" || typeof amount.decimals !== "number" ||
        typeof amount.amountBaseUnits !== "string" || !/^\d+$/.test(amount.amountBaseUnits) ||
        (amount.direction !== "spend" && amount.direction !== "receive")) return [];
      return [{
        symbol: amount.symbol, decimals: amount.decimals, amountBaseUnits: amount.amountBaseUnits,
        direction: amount.direction as "spend" | "receive",
        ...(amount.estimated === true ? { estimated: true } : {}),
        ...(amount.maximum === true ? { maximum: true } : {}),
      }];
    });
    const metadata = item.summary.metadata;
    return [{
      id: item.id, kind: item.kind, status: item.status,
      summary: {
        ...(isRecord(metadata) && metadata.product === "borrow" && typeof metadata.operation === "string"
          ? { metadata: { product: "borrow" as const, operation: metadata.operation } }
          : isRecord(metadata) && metadata.product === "trade" && (metadata.direction === "buy" || metadata.direction === "sell")
            ? { metadata: { product: "trade" as const, direction: metadata.direction } }
            : {}),
        amounts,
        warnings: item.summary.warnings.filter((warning): warning is string => typeof warning === "string"),
      },
    }];
  });
}

function actionToastMessage(action: ToastAction, status: ToastAction["status"]): string | null {
  const metadata = action.summary.metadata;
  const tradeDirection = action.kind === "trade" && metadata?.product === "trade" ? metadata.direction : null;
  if (tradeDirection) {
    const spend = action.summary.amounts.find((amount) => amount.direction === "spend" && !amount.estimated && !amount.maximum);
    if (!spend) return null;
    const formatted = tradeDirection === "buy"
      ? formatFiatAmount(BigInt(spend.amountBaseUnits), spend.decimals, "USD")
      : formatPresentationTokenAmount(spend.amountBaseUnits, spend.decimals, "BTC");
    return tradeDirection === "buy"
      ? `${status === "pending" ? "Buying" : "Bought"} Bitcoin for ${formatted}`
      : `${status === "pending" ? "Selling" : "Sold"} ${formatted} of Bitcoin`;
  }
  const borrowOperation = metadata?.product === "borrow" ? metadata.operation : undefined;
  const operation = operationKind(action.kind, borrowOperation);
  if (borrowOperation === "repay-all") return status === "pending" ? "Repaying all Borrow debt" : "Repaid all Borrow debt";
  if (borrowOperation === "close-position") return status === "pending" ? "Closing Borrow position" : "Closed Borrow position";
  const amount = action.summary.amounts.find((candidate) =>
    operation === "withdraw" || operation === "cash-out-withdraw" || operation === "borrow"
      ? candidate.direction === "receive" && !candidate.estimated && !candidate.maximum
      : candidate.direction === "spend" && !candidate.estimated && !candidate.maximum,
  );
  if (!amount) return null;
  const formatted = amount.symbol === "USDC"
    ? formatFiatAmount(BigInt(amount.amountBaseUnits), amount.decimals, "USD")
    : formatPresentationTokenAmount(amount.amountBaseUnits, amount.decimals, amount.symbol);
  if (operation === "send") {
    const recipient = action.summary.warnings.find((warning) => warning.startsWith("Recipient: "))?.slice("Recipient: ".length);
    const target = recipient && /^0x[0-9a-fA-F]{40}$/.test(recipient) ? ` to ${formatAddress(recipient)}` : "";
    return `${status === "pending" ? "Sending" : "Sent"} ${formatted}${target}`;
  }
  if (operation === "deposit") return `${status === "pending" ? "Depositing" : "Deposited"} ${formatted}`;
  if (operation === "withdraw") return `${status === "pending" ? "Withdrawing" : "Withdrawn"} ${formatted}`;
  if (operation === "supply-collateral") return `${status === "pending" ? "Adding collateral" : "Added collateral"} ${formatted}`;
  if (operation === "withdraw-collateral") return `${status === "pending" ? "Withdrawing collateral" : "Withdrew collateral"} ${formatted}`;
  if (operation === "borrow") return `${status === "pending" ? "Borrowing" : "Borrowed"} ${formatted}`;
  if (operation === "repay") return `${status === "pending" ? "Repaying" : "Repaid"} ${formatted}`;
  if (operation === "cash-out") return `${status === "pending" ? "Cashing out" : "Cashed out"} ${formatted}`;
  if (operation === "cash-out-withdraw") return `${status === "pending" ? "Recovering" : "Recovered"} ${formatted}`;
  if (operation === "close-position") return status === "pending" ? "Closing Borrow position" : "Closed Borrow position";
  return null;
}

function operationKind(kind: string, borrowOperation?: string): "send" | "deposit" | "withdraw" | "cash-out" | "cash-out-withdraw" | "supply-collateral" | "withdraw-collateral" | "borrow" | "repay" | "close-position" | null {
  if (borrowOperation === "borrow" || borrowOperation === "supply-and-borrow") return "borrow";
  if (borrowOperation === "repay" || borrowOperation === "repay-all") return "repay";
  if (borrowOperation === "close-position") return "close-position";
  if (borrowOperation === "supply-collateral") return "supply-collateral";
  if (borrowOperation === "withdraw-collateral") return "withdraw-collateral";
  if (kind === "send") return "send";
  if (kind === "savings-deposit") return "deposit";
  if (kind === "savings-withdraw") return "withdraw";
  if (kind === "cash-out") return "cash-out";
  if (kind === "cash-out-withdraw") return "cash-out-withdraw";
  if (kind === "supply-collateral") return "supply-collateral";
  if (kind === "withdraw-collateral") return "withdraw-collateral";
  if (kind === "borrow") return "borrow";
  if (kind === "repay") return "repay";
  return null;
}
function failedVerb(kind: string): string {
  switch (kind) {
    case "send": return "Send";
    case "savings-deposit": return "Deposit";
    case "savings-withdraw": return "Withdrawal";
    case "cash-out": return "Cash-out";
    case "cash-out-withdraw": return "Cash-out withdrawal";
    case "supply-collateral": return "Adding collateral";
    case "withdraw-collateral": return "Withdrawing collateral";
    case "borrow": return "Borrow";
    case "repay": return "Repayment";
    case "trade": return "Trade";
    default: return "Action";
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

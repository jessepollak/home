"use client";

import { Toaster } from "@/components/ui/toast";
import { useCallback, useEffect, useRef } from "react";
import { homeToastDurationMs, useHomeToast, type HomeToastRole, type HomeToastTone } from "./use-home-toast";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { RegionId } from "@/config/regions";
import { formatAddress, formatFiatAmount, formatPresentationTokenAmount } from "@/shared/formatting";
import { useHomeQuery } from "@/client/query/query-client";
import { activityOwnerKey } from "@/client/activity/use-activity";
import { cashoutMoney, cashoutProgress, linkedCashoutWithdraw, presentCashout } from "@/client/activity/cash-out-presenter";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import { actionFailureEvent } from "./action-toast-events";
import { recentActionsQuery } from "@/client/actions/recent-actions-query";

const defaultDismissAfterMs = homeToastDurationMs;
type Seen = { status: RecentMoneyActionOperation["status"]; stage: string | null };
type ActionToastMessage = { message: string; regionSensitive: boolean };

function stageFor(action: RecentMoneyActionOperation, actions: RecentMoneyActionOperation[]): string | null {
  return action.action.kind === "cash-out" ? cashoutProgress(action, linkedCashoutWithdraw(action, actions)).stage : null;
}

export function ActionToasts({
  session,
  regionId,
  fetchOperations,
  dismissAfterMs = defaultDismissAfterMs,
}: {
  session: VerifiedAccountSession | null;
  regionId: RegionId;
  fetchOperations: (signal?: AbortSignal) => Promise<unknown>;
  dismissAfterMs?: number;
}) {
  const ownerKey = session?.smartAccount ? activityOwnerKey(session) : null;
  const seenStatuses = useRef(new Map<string, Seen>());
  const regionToastIds = useRef(new Set<string>());
  const seededOwners = useRef(new Set<string>());
  const previousPresentation = useRef({ ownerKey, regionId });
  const { add, close, closeAll } = useHomeToast(ownerKey);
  const actions = useHomeQuery({
    ...recentActionsQuery({ owner: ownerKey, session, fetchOperations }),
    refetchInterval: (query) => {
      if (typeof document === "undefined" || document.visibilityState !== "visible" || !Array.isArray(query.state.data?.operations)) return false;
      const operations = query.state.data.operations;
      return operations.some((action) => action.action.kind === "cash-out" &&
        cashoutProgress(action, linkedCashoutWithdraw(action, operations)).refreshing) ? 15_000 : false;
    },
  });
  const addToast = useCallback((message: string, tone: HomeToastTone = "neutral", role: HomeToastRole = "status", regionSensitive = false) => {
    const id = add({
      message, tone, role, duration: dismissAfterMs,
      ...(regionSensitive ? { onClose: () => regionToastIds.current.delete(id) } : {}),
    });
    if (regionSensitive) regionToastIds.current.add(id);
  }, [add, dismissAfterMs]);

  useEffect(() => () => closeAll(), [closeAll]);
  useEffect(() => {
    const previous = previousPresentation.current;
    if (previous.ownerKey !== ownerKey) {
      regionToastIds.current.clear();
    } else if (ownerKey && previous.regionId !== regionId) {
      for (const id of regionToastIds.current) close(id);
      regionToastIds.current.clear();
    }
    previousPresentation.current = { ownerKey, regionId };
  }, [close, ownerKey, regionId]);
  useEffect(() => {
    if (!ownerKey || !Array.isArray(actions.data?.operations)) return;
    const operations = actions.data.operations;
    if (!seededOwners.current.has(ownerKey)) {
      for (const action of operations) {
        seenStatuses.current.set(`${ownerKey}\u0000${action.action.id}`, { status: action.status, stage: stageFor(action, operations) });
      }
      seededOwners.current.add(ownerKey);
      return;
    }
    for (const action of operations) {
      const key = `${ownerKey}\u0000${action.action.id}`;
      const previous = seenStatuses.current.get(key);
      const stage = stageFor(action, operations);
      if (action.action.kind === "cash-out") {
        const view = presentCashout(action, linkedCashoutWithdraw(action, operations), { regionId });
        const amount = cashoutMoney(view.total, view.decimals, regionId);
        if (previous === undefined && action.status === "pending") {
          addToast(`Cash-out started ${amount}`, "neutral", "status", true);
        } else if (previous?.stage && previous.stage !== stage && view.stage === "paid") {
          addToast(`Paid ${amount} to ${view.app}`, "success", "status", true);
        } else if (previous?.stage && previous.stage !== stage && view.stage === "returned") {
          const paid = BigInt(view.paid) !== BigInt(0);
          const returned = view.returned !== "0";
          addToast(paid ? view.status : returned ? `Returned ${cashoutMoney(view.returned, view.decimals, regionId)}` : "Returned",
            "success", "status", paid || returned);
        }
      } else if (action.status === "pending" && previous === undefined) {
        const message = actionToastMessage(action, "pending", regionId);
        if (message) addToast(message.message, "neutral", "status", message.regionSensitive);
      } else if (action.status === "confirmed" && previous?.status === "pending") {
        const message = actionToastMessage(action, "confirmed", regionId);
        if (message) addToast(message.message, "success", "status", message.regionSensitive);
      }
      seenStatuses.current.set(key, { status: action.status, stage });
    }
  }, [actions.data, addToast, ownerKey, regionId]);
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

function actionToastMessage(action: RecentMoneyActionOperation, status: "pending" | "confirmed", regionId: RegionId): ActionToastMessage | null {
  const metadata = action.action.metadata;
  if (action.action.kind === "card-allowance" && metadata?.product === "card") {
    const message = metadata.operation === "set-allowance"
      ? status === "pending" ? "Setting card spending limit" : "Card spending limit set"
      : status === "pending" ? "Removing card spending permission" : "Card spending permission removed";
    return { message, regionSensitive: false };
  }
  const trade = action.action.kind === "trade" && metadata?.product === "trade" ? metadata : null;
  if (trade) {
    const spend = action.action.amounts.find((amount) => amount.direction === "spend" && !amount.estimated && !amount.maximum);
    if (!spend) return null;
    const formatted = trade.direction === "buy"
      ? formatFiatAmount(BigInt(spend.amountBaseUnits), spend.decimals, "USD", { regionId })
      : formatPresentationTokenAmount(spend.amountBaseUnits, spend.decimals, spend.symbol);
    return {
      message: trade.direction === "buy"
        ? `${status === "pending" ? "Buying" : "Bought"} ${trade.assetName} for ${formatted}`
        : `${status === "pending" ? "Selling" : "Sold"} ${formatted} of ${trade.assetName}`,
      regionSensitive: trade.direction === "buy",
    };
  }
  const borrowOperation = metadata?.product === "borrow" ? metadata.operation : undefined;
  const operation = operationKind(action.action.kind, borrowOperation);
  if (borrowOperation === "repay-all") return { message: status === "pending" ? "Repaying all Borrow debt" : "Repaid all Borrow debt", regionSensitive: false };
  if (borrowOperation === "close-position") return { message: status === "pending" ? "Closing Borrow position" : "Closed Borrow position", regionSensitive: false };
  const amount = action.action.amounts.find((candidate) =>
    operation === "withdraw" || operation === "cash-out-withdraw" || operation === "borrow"
      ? candidate.direction === "receive" && !candidate.estimated && !candidate.maximum
      : candidate.direction === "spend" && !candidate.estimated && !candidate.maximum,
  );
  if (!amount) return null;
  const formatted = amount.symbol === "USDC"
    ? formatFiatAmount(BigInt(amount.amountBaseUnits), amount.decimals, "USD", { regionId })
    : formatPresentationTokenAmount(amount.amountBaseUnits, amount.decimals, amount.symbol);
  const withAmount = (message: string): ActionToastMessage => ({
    message, regionSensitive: amount.symbol === "USDC" || operation === "cash-out-withdraw",
  });
  if (operation === "send") {
    const recipient = action.action.warnings.find((warning) => warning.startsWith("Recipient: "))?.slice("Recipient: ".length);
    const target = recipient && /^0x[0-9a-fA-F]{40}$/.test(recipient) ? ` to ${formatAddress(recipient)}` : "";
    return withAmount(`${status === "pending" ? "Sending" : "Sent"} ${formatted}${target}`);
  }
  if (operation === "deposit") return withAmount(`${status === "pending" ? "Depositing" : "Deposited"} ${formatted}`);
  if (operation === "withdraw") return withAmount(`${status === "pending" ? "Withdrawing" : "Withdrawn"} ${formatted}`);
  if (operation === "supply-collateral") return withAmount(`${status === "pending" ? "Adding collateral" : "Added collateral"} ${formatted}`);
  if (operation === "withdraw-collateral") return withAmount(`${status === "pending" ? "Withdrawing collateral" : "Withdrew collateral"} ${formatted}`);
  if (operation === "borrow") return withAmount(`${status === "pending" ? "Borrowing" : "Borrowed"} ${formatted}`);
  if (operation === "repay") return withAmount(`${status === "pending" ? "Repaying" : "Repaid"} ${formatted}`);
  if (operation === "cash-out-withdraw") return status === "pending" ? withAmount(`Returning ${cashoutMoney(amount.amountBaseUnits, amount.decimals, regionId)}`) : null;
  if (operation === "close-position") return { message: status === "pending" ? "Closing Borrow position" : "Closed Borrow position", regionSensitive: false };
  return null;
}

function operationKind(kind: string, borrowOperation?: string): "send" | "deposit" | "withdraw" | "cash-out-withdraw" | "supply-collateral" | "withdraw-collateral" | "borrow" | "repay" | "close-position" | null {
  if (borrowOperation === "borrow" || borrowOperation === "supply-and-borrow") return "borrow";
  if (borrowOperation === "repay" || borrowOperation === "repay-all") return "repay";
  if (borrowOperation === "close-position") return "close-position";
  if (borrowOperation === "supply-collateral") return "supply-collateral";
  if (borrowOperation === "withdraw-collateral") return "withdraw-collateral";
  if (kind === "send") return "send";
  if (kind === "savings-deposit") return "deposit";
  if (kind === "savings-withdraw") return "withdraw";
  if (kind === "cash-out-withdraw") return "cash-out-withdraw";
  if (kind === "supply-collateral" || kind === "withdraw-collateral" || kind === "borrow" || kind === "repay") return kind;
  return null;
}
function failedVerb(kind: string): string {
  switch (kind) {
    case "send": return "Send";
    case "card-allowance": return "Card spending limit";
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

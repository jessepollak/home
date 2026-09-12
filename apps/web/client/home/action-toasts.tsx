"use client";

import { Button, Text } from "@home/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { formatAddress, formatFiatAmount, formatPresentationTokenAmount } from "@/shared/formatting";
import { ownerQueryKey, ownerQueryMeta, useHomeQuery } from "@/client/query/query-client";
import { activityOwnerKey } from "@/client/activity/use-activity";
import { actionFailureEvent } from "./action-toast-events";
import styles from "./action-toasts.module.css";
const defaultDismissAfterMs = 5_000;

type Toast = { id: number; message: string };
type ToastAction = {
  id: string;
  kind: string;
  status: "pending" | "confirmed";
  summary: {
    amounts: Array<{
      symbol: string;
      decimals: number;
      amountBaseUnits: string;
      direction: "spend" | "receive";
      estimated?: boolean;
    }>;
    warnings: string[];
  };
};

export type ActionToastClock = {
  setTimer: (callback: () => void, delayMs: number) => unknown;
  clearTimer: (timer: unknown) => void;
};

const browserClock: ActionToastClock = {
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

export function ActionToasts({
  session,
  fetchOperations,
  clock = browserClock,
  dismissAfterMs = defaultDismissAfterMs,
}: {
  session: VerifiedAccountSession | null;
  fetchOperations: (signal?: AbortSignal) => Promise<unknown>;
  clock?: ActionToastClock;
  dismissAfterMs?: number;
}) {
  const ownerKey = session?.smartAccount ? activityOwnerKey(session) : null;
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, unknown>());
  const seenStatuses = useRef(new Map<string, ToastAction["status"]>());
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

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) clock.clearTimer(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, [clock, setToasts]);

  const addToast = useCallback((message: string) => {
    const id = ++nextId.current;
    setToasts((current) => [...current, { id, message }]);
    timers.current.set(id, clock.setTimer(() => dismiss(id), dismissAfterMs));
  }, [clock, dismiss, dismissAfterMs, setToasts]);

  useEffect(() => () => {
    for (const timer of timers.current.values()) clock.clearTimer(timer);
    timers.current.clear();
  }, [clock]);

  useEffect(() => {
    if (!actions.data) return;
    for (const action of actions.data) {
      const statusKey = `${ownerKey}\u0000${action.id}`;
      const previous = seenStatuses.current.get(statusKey);
      if (action.status === "pending" && previous === undefined) {
        const message = actionToastMessage(action, "pending");
        if (message) addToast(message);
      } else if (action.status === "confirmed" && previous && previous !== "confirmed") {
        const message = actionToastMessage(action, "confirmed");
        if (message) addToast(message);
      }
      seenStatuses.current.set(statusKey, action.status);
    }
  }, [actions.data, addToast, ownerKey]);

  useEffect(() => {
    const onFailure = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!isRecord(detail) || typeof detail.kind !== "string" || typeof detail.reason !== "string") return;
      addToast(`${failedVerb(detail.kind)} failed: ${detail.reason}`);
    };
    window.addEventListener(actionFailureEvent, onFailure);
    return () => window.removeEventListener(actionFailureEvent, onFailure);
  }, [addToast]);

  return (
    <div className={styles.region} aria-live="polite" aria-relevant="additions">
      {toasts.map((toast) => (
        <div className={`${styles.toast} surface-primary`} key={toast.id}>
          <Text as="span" textStyle="body" className={styles.message}>{toast.message}</Text>
          <Button variant="quiet" className={styles.dismiss} onClick={() => dismiss(toast.id)} aria-label={`Dismiss ${toast.message}`}>
            Dismiss
          </Button>
        </div>
      ))}
    </div>
  );
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
        symbol: amount.symbol,
        decimals: amount.decimals,
        amountBaseUnits: amount.amountBaseUnits,
        direction: amount.direction as "spend" | "receive",
        ...(amount.estimated === true ? { estimated: true } : {}),
      }];
    });
    return [{
      id: item.id,
      kind: item.kind,
      status: item.status,
      summary: {
        amounts,
        warnings: item.summary.warnings.filter((warning): warning is string => typeof warning === "string"),
      },
    }];
  });
}

function actionToastMessage(action: ToastAction, status: ToastAction["status"]): string | null {
  const operation = operationKind(action.kind);
  const amount = action.summary.amounts.find((candidate) =>
    operation === "withdraw" ? candidate.direction === "receive" && !candidate.estimated : candidate.direction === "spend" && !candidate.estimated,
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
  return null;
}

function operationKind(kind: string): "send" | "deposit" | "withdraw" | "supply-collateral" | "withdraw-collateral" | null {
  if (kind === "send") return "send";
  if (kind === "savings-deposit") return "deposit";
  if (kind === "savings-withdraw") return "withdraw";
  if (kind === "supply-collateral") return "supply-collateral";
  if (kind === "withdraw-collateral") return "withdraw-collateral";
  return null;
}

function failedVerb(kind: string): string {
  switch (kind) {
    case "send": return "Send";
    case "savings-deposit": return "Deposit";
    case "savings-withdraw": return "Withdrawal";
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

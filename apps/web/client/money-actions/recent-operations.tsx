"use client";

import { useEffect, useState } from "react";
import { ActivityRow } from "@/components/finance-rows";
import { TransactionDetailsModal } from "@/components/transaction-details";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { formatPresentationTokenAmount } from "@/shared/formatting";
import { visibleActivityMoneyActions } from "@/shared/money-actions/activity-visibility";
import {
  labelForOperationStatus,
  presentOperationDetails,
  primaryOperationAmount,
} from "./operation-details";
import type {
  MoneyActionOperationStatus,
  PreparedMoneyAction,
} from "@/shared/money-actions/types";
import styles from "./recent-operations.module.css";

export type RecentMoneyActionOperation = {
  action: PreparedMoneyAction;
  status: MoneyActionOperationStatus;
  attemptCount: number;
  submissionId?: string;
  transactionHash?: `0x${string}`;
  userOperationHash?: `0x${string}`;
  createdAt: string;
  updatedAt: string;
};

export type FetchRecentMoneyActions = (signal?: AbortSignal) => Promise<unknown>;
export type ReadRecentMoneyAction = (id: string, signal?: AbortSignal) => Promise<unknown>;
export type CheckRecentMoneyAction = (action: PreparedMoneyAction) => Promise<unknown>;

export function RecentMoneyActions({
  session,
  fetchOperations,
  readOperation,
  checkOperation,
  refreshTrigger,
  excludeTransactionHashes = [],
  embedded = false,
  showUnavailableNotice = true,
  onVisibleCountChange,
}: {
  session: VerifiedAccountSession | null;
  fetchOperations: FetchRecentMoneyActions;
  readOperation: ReadRecentMoneyAction;
  checkOperation?: CheckRecentMoneyAction;
  refreshTrigger?: string | number;
  excludeTransactionHashes?: Iterable<string>;
  embedded?: boolean;
  showUnavailableNotice?: boolean;
  onVisibleCountChange?: (count: number) => void;
}) {
  const ownerKey = session?.smartAccount
    ? `${session.user.subject}\u0000${session.smartAccount.address}\u0000${session.accountProvider}`
    : null;
  const [selectedOperationId, setSelectedOperationId] = useState<string | null>(null);
  const [selectedOwnerKey, setSelectedOwnerKey] = useState<string | null>(ownerKey);
  if (selectedOwnerKey !== ownerKey) {
    setSelectedOwnerKey(ownerKey);
    setSelectedOperationId(null);
  }
  const [state, setState] = useState<{
    ownerKey: string;
    operations: RecentMoneyActionOperation[];
    unavailable: boolean;
    checkingIds: string[];
  } | null>(null);
  const excluded = new Set(
    Array.from(excludeTransactionHashes, (hash) => hash.toLowerCase()),
  );

  useEffect(() => {
    if (!session?.smartAccount || !ownerKey) return;
    const controller = new AbortController();
    void fetchOperations(controller.signal)
      .then(async (value) => {
        if (controller.signal.aborted) return;
        const operations = parseRecentMoneyActions(value, session);
        setState({ ownerKey, operations, unavailable: false, checkingIds: [] });
        const recoverable = operations.filter(isReadRecoverable).slice(0, 3);
        await Promise.all(recoverable.map(async (operation) => {
          try {
            const refreshed = parseReadOperation(
              await readOperation(operation.action.id, controller.signal),
              session,
            );
            if (!controller.signal.aborted && refreshed) {
              setState((current) => current?.ownerKey === ownerKey
                ? { ...current, operations: replaceOperation(current.operations, refreshed) }
                : current);
            }
          } catch {
            // Durable operation history remains useful when receipt reconciliation is unavailable.
          }
        }));
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({ ownerKey, operations: [], unavailable: true, checkingIds: [] });
        }
      });
    return () => controller.abort();
  }, [fetchOperations, ownerKey, readOperation, refreshTrigger, session]);

  const visibleState = state?.ownerKey === ownerKey ? state : null;
  const visible = visibleActivityMoneyActions(
    dedupeRecentMoneyActions(visibleState?.operations ?? [], excluded),
  ); // stale-payload guard; ordinary list API already omits pre-chain Rejected
  const visibleCount =
    visible.length + (visibleState?.unavailable && showUnavailableNotice ? 1 : 0);
  const selectedOperation = selectedOperationId
    ? visible.find((operation) => operation.action.id === selectedOperationId) ?? null
    : null;
  const details = selectedOperation
    ? presentOperationDetails(selectedOperation)
    : null;
  const detailsTitleId = "home-operation-details-title";

  useEffect(() => {
    onVisibleCountChange?.(visibleCount);
  }, [onVisibleCountChange, visibleCount]);

  if (
    visible.length === 0 &&
    (!visibleState?.unavailable || !showUnavailableNotice)
  ) {
    return null;
  }

  return (
    <section
      className={styles.section}
      aria-labelledby={embedded ? undefined : "home-operations-title"}
    >
      {embedded ? null : <h3 id="home-operations-title">Home actions</h3>}
      {visibleState?.unavailable ? (
        <p className={styles.message} role="status">
          Recorded Home actions are unavailable. Onchain transfers are still shown.
        </p>
      ) : (
        <ol className={styles.list}>
          {visible.map((operation) => (
            <OperationRow
              key={operation.action.id}
              operation={operation}
              checking={visibleState?.checkingIds.includes(operation.action.id) ?? false}
              onActivate={() => setSelectedOperationId(operation.action.id)}
              onCheck={offersStatusCheck(operation) ? async () => {
                setState((current) => current?.ownerKey === ownerKey
                  ? { ...current, checkingIds: [...new Set([...current.checkingIds, operation.action.id])] }
                  : current);
                try {
                  if (checkOperation) {
                    try {
                      await checkOperation(operation.action);
                    } catch {
                      // Pure status checks may be temporarily unavailable; keep the durable row.
                    }
                  }
                  const refreshed = parseReadOperation(await readOperation(operation.action.id), session!);
                  if (refreshed) {
                    setState((current) => current?.ownerKey === ownerKey
                      ? { ...current, operations: replaceOperation(current.operations, refreshed) }
                      : current);
                  }
                } catch {
                  // Keep the durable unresolved row visible for a later retry.
                } finally {
                  setState((current) => current?.ownerKey === ownerKey
                    ? { ...current, checkingIds: current.checkingIds.filter((id) => id !== operation.action.id) }
                    : current);
                }
              } : undefined}
            />
          ))}
        </ol>
      )}

      <TransactionDetailsModal
        open={selectedOperation !== null}
        titleId={detailsTitleId}
        details={details}
        onClose={() => setSelectedOperationId(null)}
      />
    </section>
  );
}

export function parseRecentMoneyActions(
  value: unknown,
  session: VerifiedAccountSession,
): RecentMoneyActionOperation[] {
  if (!session.smartAccount || !isRecord(value) || !Array.isArray(value.operations)) return [];
  const seen = new Set<string>();
  const parsed: RecentMoneyActionOperation[] = [];
  for (const candidate of value.operations) {
    if (!isRecord(candidate) || !isRecord(candidate.action) || !isRecord(candidate.action.owner)) continue;
    const action = candidate.action as unknown as PreparedMoneyAction;
    if (
      typeof action.id !== "string" || seen.has(action.id) ||
      action.owner.subject !== session.user.subject ||
      typeof action.owner.address !== "string" ||
      action.owner.address.toLowerCase() !== session.smartAccount.address.toLowerCase() ||
      action.owner.chainId !== 8453 ||
      action.owner.accountProvider !== session.accountProvider ||
      !Array.isArray(action.calls) || !Array.isArray(action.amounts) || !Array.isArray(action.warnings) ||
      !isOperationStatus(candidate.status) ||
      typeof candidate.attemptCount !== "number" || !Number.isSafeInteger(candidate.attemptCount) || candidate.attemptCount < 0 ||
      typeof candidate.createdAt !== "string" || !validIso(candidate.createdAt) ||
      typeof candidate.updatedAt !== "string" || !validIso(candidate.updatedAt)
    ) continue;
    const transactionHash = optionalHash(candidate.transactionHash);
    const userOperationHash = optionalHash(candidate.userOperationHash);
    if (transactionHash === false || userOperationHash === false) continue;
    seen.add(action.id);
    parsed.push({
      ...(candidate as unknown as RecentMoneyActionOperation),
      ...(transactionHash ? { transactionHash } : { transactionHash: undefined }),
      ...(userOperationHash ? { userOperationHash } : { userOperationHash: undefined }),
    });
  }
  return parsed.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function dedupeRecentMoneyActions(
  operations: RecentMoneyActionOperation[],
  excludedTransactionHashes: ReadonlySet<string>,
): RecentMoneyActionOperation[] {
  return operations.filter(
    (operation) =>
      !operation.transactionHash ||
      !excludedTransactionHashes.has(operation.transactionHash.toLowerCase()),
  );
}

function OperationRow({
  operation,
  checking,
  onCheck,
  onActivate,
}: {
  operation: RecentMoneyActionOperation;
  checking: boolean;
  onCheck?: () => Promise<void>;
  onActivate?: () => void;
}) {
  const amount = primaryOperationAmount(operation);
  const status = labelForOperationStatus(operation.status);
  const date = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(operation.updatedAt));
  const value = amount
    ? `${amount.direction === "spend" ? "−" : "+"}${amount.estimated ? "~" : ""}${formatPresentationTokenAmount(
        amount.amountBaseUnits,
        amount.decimals,
        amount.symbol,
        { cashCurrency: amount.symbol === "USDC" ? "USD" : null },
      )}`
    : status;
  return (
    <ActivityRow
      icon={iconForStatus(operation.status)}
      iconTone={operation.status === "failed" || operation.status === "rejected" ? "outlined" : amount?.direction === "receive" ? "incoming" : "outgoing"}
      label={operation.action.title}
      context={(
        <>
          <time dateTime={operation.updatedAt}>{date}</time> · {status}
          {onCheck ? (
            <> · <button className={styles.check} type="button" disabled={checking} onClick={() => void onCheck()}>
              {checking ? "Checking…" : "Check status"}
            </button></>
          ) : null}
        </>
      )}
      value={value}
      valueTone={operation.status === "failed" || operation.status === "rejected" ? "error" : operation.status === "unknown" ? "muted" : "default"}
      onActivate={onActivate}
      activateLabel={`View ${operation.action.title} transaction details`}
    />
  );
}

function parseReadOperation(
  value: unknown,
  session: VerifiedAccountSession,
): RecentMoneyActionOperation | null {
  if (!isRecord(value) || !isRecord(value.operation)) return null;
  return parseRecentMoneyActions({ operations: [value.operation] }, session)[0] ?? null;
}

function replaceOperation(
  operations: RecentMoneyActionOperation[],
  replacement: RecentMoneyActionOperation,
): RecentMoneyActionOperation[] {
  return operations
    .map((operation) => operation.action.id === replacement.action.id ? replacement : operation)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function offersStatusCheck(operation: RecentMoneyActionOperation): boolean {
  // prepared is read-only Check status: recover/execute would claim and dispatch.
  return operation.status === "prepared" || isReadRecoverable(operation);
}

function isReadRecoverable(operation: RecentMoneyActionOperation): boolean {
  return ["submitting", "submitted", "included", "unknown"].includes(operation.status);
}

function iconForStatus(status: MoneyActionOperationStatus): string {
  if (status === "confirmed") return "✓";
  if (status === "failed" || status === "rejected" || status === "expired") return "×";
  if (status === "unknown") return "?";
  return "↑";
}

function validIso(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false;
  return Number.isFinite(new Date(value).getTime());
}

function optionalHash(value: unknown): `0x${string}` | undefined | false {
  if (value === undefined || value === null || value === "") return undefined;
  return isHash(value) ? value : false;
}

function isHash(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function isOperationStatus(value: unknown): value is MoneyActionOperationStatus {
  return ["prepared", "submitting", "submitted", "included", "confirmed", "rejected", "expired", "failed", "unknown"].includes(value as string);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

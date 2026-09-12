"use client";

import { MfaError } from "@coinbase/cdp-core";
import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { AccountSessionStatus, AccountWalletSdkBoundary } from "./cdp-client";
import type { OwnerGenerationFence } from "./cdp-session-lifecycle";
import type { AuthenticatedTransport } from "./cdp-authenticated-transport";
import type { SessionFetch, VerifiedAccountSession } from "./session-client";
import { BaseAccountConnectorError, type ConnectedBaseAccount } from "./base-account-connector";
import type { OperationResult, PreparedMoneyAction } from "@/shared/money-actions/types";
import { TransferExecutionError } from "@/shared/transfers/types";
import { announceActionFailure } from "@/client/home/action-toast-events";

const hashPattern = /^0x[0-9a-fA-F]{64}$/;
const resolutionInitialDelayMs = 1_500;
const resolutionPollIntervalMs = 2_500;
const resolutionTimeoutMs = 3 * 60_000;

type ConfirmedPlan = {
  calls: Array<{ to: `0x${string}`; data: `0x${string}`; value: string }>;
};

type GenerationGuard = Pick<OwnerGenerationFence, "assertCurrent">;

/**
 * Provider operation status folded to what Home acts on. `unavailable` means the
 * status could not be read at all: stop polling, never announce a failure.
 */
export type ResolutionState = {
  status: "pending" | "complete" | "failed" | "unavailable";
  transactionHash?: string;
  reason?: string;
};

const CDP_STATUS_MAP: Record<string, ResolutionState["status"]> = {
  pending: "pending",
  signed: "pending",
  broadcast: "pending",
  complete: "complete",
  failed: "failed",
  dropped: "failed",
};

export type ResolutionClock = {
  now: () => number;
  setTimer: (callback: () => void, delayMs: number) => unknown;
  clearTimer: (timer: unknown) => void;
};

const browserResolutionClock: ResolutionClock = {
  now: Date.now,
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

export function pollTransactionResolution(input: {
  generation: number;
  fence: GenerationGuard;
  check: () => Promise<ResolutionState>;
  recordTransactionHash: (transactionHash: string) => Promise<void>;
  onFailedWithoutHash: (reason: string) => void;
  clock?: ResolutionClock;
  initialDelayMs?: number;
  intervalMs?: number;
  timeoutMs?: number;
}): { result: Promise<void>; cancel: () => void } {
  const clock = input.clock ?? browserResolutionClock;
  const startedAt = clock.now();
  const intervalMs = input.intervalMs ?? resolutionPollIntervalMs;
  const timeoutMs = input.timeoutMs ?? resolutionTimeoutMs;
  let timer: unknown;
  let settled = false;
  let resolveResult!: () => void;
  const result = new Promise<void>((resolve) => { resolveResult = resolve; });
  const finish = () => {
    if (settled) return;
    settled = true;
    if (timer !== undefined) clock.clearTimer(timer);
    resolveResult();
  };
  const schedule = (delayMs: number) => {
    if (!settled) timer = clock.setTimer(() => void poll(), delayMs);
  };
  const poll = async () => {
    if (settled || clock.now() - startedAt >= timeoutMs) {
      finish();
      return;
    }
    try {
      input.fence.assertCurrent(input.generation);
    } catch {
      finish();
      return;
    }
    let state: ResolutionState;
    try {
      state = await input.check();
    } catch {
      schedule(intervalMs);
      return;
    }
    if (settled) return;
    try {
      input.fence.assertCurrent(input.generation);
    } catch {
      finish();
      return;
    }
    if ((state.status === "complete" || state.status === "failed") && state.transactionHash) {
      try {
        await input.recordTransactionHash(state.transactionHash);
      } catch {
        schedule(intervalMs);
        return;
      }
      finish();
      return;
    }
    if (state.status === "failed") {
      input.onFailedWithoutHash(state.reason ?? "The wallet operation failed.");
      finish();
      return;
    }
    if (state.status === "unavailable") {
      finish();
      return;
    }
    schedule(intervalMs);
  };
  schedule(input.initialDelayMs ?? resolutionInitialDelayMs);
  return { result, cancel: finish };
}

function isUserRejectedDispatch(error: unknown): boolean {
  return (
    error instanceof BaseAccountConnectorError && error.reason === "cancelled"
  ) || (
    error instanceof MfaError && error.code === "CANCELLED"
  );
}

export async function executeActionOnce(input: {
  id: string;
  generation: number;
  fence: GenerationGuard;
  confirmedPlans: Map<string, ConfirmedPlan>;
  providerDispatches: Map<string, Promise<string>>;
  confirm: () => Promise<ConfirmedPlan>;
  dispatch: (plan: ConfirmedPlan) => Promise<string>;
  recordHandle: (providerHandle: string) => Promise<void>;
}): Promise<string> {
  input.fence.assertCurrent(input.generation);
  let plan = input.confirmedPlans.get(input.id);
  if (!plan) {
    input.fence.assertCurrent(input.generation);
    plan = await input.confirm();
    input.fence.assertCurrent(input.generation);
    input.confirmedPlans.set(input.id, plan);
  }

  let dispatch = input.providerDispatches.get(input.id);
  if (!dispatch) {
    input.fence.assertCurrent(input.generation);
    dispatch = input.dispatch(plan);
    input.providerDispatches.set(input.id, dispatch);
  }
  let providerHandle: string;
  try {
    providerHandle = await dispatch;
  } catch (error) {
    if (isUserRejectedDispatch(error)) {
      if (input.providerDispatches.get(input.id) === dispatch) input.providerDispatches.delete(input.id);
      throw new TransferExecutionError("rejected", error);
    }
    throw error;
  }
  input.fence.assertCurrent(input.generation);
  await input.recordHandle(providerHandle);
  input.fence.assertCurrent(input.generation);
  return providerHandle;
}

function validPrepared(value: unknown, session: VerifiedAccountSession): value is PreparedMoneyAction {
  return Boolean(
    isRecord(value) && typeof value.id === "string" &&
    isRecord(value.owner) && session.smartAccount &&
    value.owner.subject === session.user.subject &&
    typeof value.owner.address === "string" &&
    value.owner.address.toLowerCase() === session.smartAccount.address.toLowerCase() &&
    value.owner.accountProvider === session.accountProvider &&
    Array.isArray(value.calls) && Array.isArray(value.amounts) && Array.isArray(value.warnings),
  );
}

export function useMoneyActionExecution({
  session,
  status,
  ownerKey,
  ownerFence,
  sdkSendUserOperation,
  sdkGetUserOperation,
  baseConnection,
  transport,
}: {
  session: VerifiedAccountSession | null;
  status: AccountSessionStatus;
  ownerKey: string | null;
  ownerFence: OwnerGenerationFence;
  sdkSendUserOperation: AccountWalletSdkBoundary["sendUserOperation"];
  sdkGetUserOperation: AccountWalletSdkBoundary["getUserOperation"];
  getAccessToken: () => Promise<string | null>;
  sessionFetch?: SessionFetch;
  authentication?: "cdp" | "native-base";
  baseConnection: MutableRefObject<ConnectedBaseAccount | null>;
  transport: AuthenticatedTransport;
}) {
  const preparedGeneration = useRef(new Map<string, number>());
  const confirmedPlans = useRef(new Map<string, ConfirmedPlan>());
  const providerDispatches = useRef(new Map<string, Promise<string>>());
  const resolutionRuns = useRef(new Map<string, () => void>());
  const { fetchAccountResource } = transport;

  const assertReady = useCallback(() => {
    if (!session?.smartAccount || !ownerKey || status !== "verified") {
      throw new TransferExecutionError("stale-session");
    }
    return session;
  }, [ownerKey, session, status]);

  const prepareMoneyAction = useCallback(async (kind: string, params: unknown) => {
    const active = assertReady();
    if (!kind || !isRecord(params)) throw new TransferExecutionError("invalid-request");
    const generation = ownerFence.capture();
    ownerFence.assertCurrent(generation);
    const value = await fetchAccountResource("/api/actions/prepare", {
      method: "POST",
      body: { kind, params },
    });
    ownerFence.assertCurrent(generation);
    if (!validPrepared(value, active)) throw new TransferExecutionError("unavailable");
    preparedGeneration.current.set(value.id, generation);
    return value;
  }, [assertReady, fetchAccountResource, ownerFence]);

  const resumeMoneyAction = useCallback(async (id: string) => {
    const active = assertReady();
    const generation = ownerFence.capture();
    ownerFence.assertCurrent(generation);
    const value = await fetchAccountResource(`/api/actions/${id}`);
    ownerFence.assertCurrent(generation);
    if (
      !isRecord(value) ||
      value.id !== id ||
      value.kind !== "send" ||
      !isRecord(value.summary) ||
      typeof value.summary.title !== "string" ||
      !Array.isArray(value.summary.amounts) ||
      !Array.isArray(value.summary.warnings) ||
      !Array.isArray(value.calls) ||
      typeof value.expiresAt !== "string" ||
      !active.smartAccount
    ) {
      throw new TransferExecutionError("unavailable");
    }
    const resumed: PreparedMoneyAction = {
      id,
      owner: {
        subject: active.user.subject,
        address: active.smartAccount.address,
        chainId: active.smartAccount.chainId,
        accountProvider: active.accountProvider,
      },
      kind: value.kind,
      title: value.summary.title,
      calls: value.calls as PreparedMoneyAction["calls"],
      amounts: value.summary.amounts as PreparedMoneyAction["amounts"],
      warnings: value.summary.warnings as string[],
      expiresAt: value.expiresAt,
      createdAt: new Date().toISOString(),
    };
    preparedGeneration.current.set(id, generation);
    return resumed;
  }, [assertReady, fetchAccountResource, ownerFence]);

  const postHandle = useCallback(async (
    id: string,
    generation: number,
    body: { providerHandle?: string; transactionHash?: string },
  ) => {
    ownerFence.assertCurrent(generation);
    await fetchAccountResource(`/api/actions/${id}/handle`, { method: "POST", body });
    ownerFence.assertCurrent(generation);
  }, [fetchAccountResource, ownerFence]);

  const resolveTransaction = useCallback((
    action: PreparedMoneyAction,
    generation: number,
    providerHandle: string,
  ) => {
    const run = pollTransactionResolution({
      generation,
      fence: ownerFence,
      check: async () => {
        if (action.owner.accountProvider === "cdp-embedded") {
          if (!sdkGetUserOperation || !hashPattern.test(providerHandle)) {
            return { status: "unavailable" };
          }
          const result = await sdkGetUserOperation({
            userOperationHash: providerHandle as `0x${string}`,
            evmSmartAccount: action.owner.address,
            network: "base",
          });
          return normalizeResolutionState(result);
        }
        const connection = baseConnection.current;
        if (!connection?.getCallsStatus) {
          return { status: "unavailable" };
        }
        return normalizeResolutionState(await connection.getCallsStatus(action.id));
      },
      recordTransactionHash: async (transactionHash) => {
        if (hashPattern.test(transactionHash)) {
          await postHandle(action.id, generation, { transactionHash });
        }
      },
      onFailedWithoutHash: (reason) => announceActionFailure(action.kind, shortFailureReason(reason)),
    });
    resolutionRuns.current.get(action.id)?.();
    resolutionRuns.current.set(action.id, run.cancel);
    void run.result.finally(() => {
      if (resolutionRuns.current.get(action.id) === run.cancel) resolutionRuns.current.delete(action.id);
    });
  }, [baseConnection, ownerFence, postHandle, sdkGetUserOperation]);

  const executeMoneyAction = useCallback(async (action: PreparedMoneyAction): Promise<OperationResult> => {
    const active = assertReady();
    const generation = preparedGeneration.current.get(action.id);
    if (generation === undefined) throw new TransferExecutionError("stale-session");
    ownerFence.assertCurrent(generation);
    if (active.user.subject !== action.owner.subject || active.accountProvider !== action.owner.accountProvider) {
      throw new TransferExecutionError("stale-session");
    }

    let providerHandle: string;
    try {
      providerHandle = await executeActionOnce({
        id: action.id,
        generation,
        fence: ownerFence,
        confirmedPlans: confirmedPlans.current,
        providerDispatches: providerDispatches.current,
        confirm: async () => {
          const response = await fetchAccountResource(`/api/actions/${action.id}/confirm`, { method: "POST", body: {} });
          if (!isRecord(response) || !Array.isArray(response.calls)) throw new TransferExecutionError("unavailable");
          return { calls: response.calls as ConfirmedPlan["calls"] };
        },
        dispatch: async (plan) => {
          const calls = plan.calls.map((call) => ({ ...call, value: BigInt(call.value) }));
          if (action.owner.accountProvider === "base-account") {
            const connection = baseConnection.current;
            if (!connection?.sendCalls || connection.address.toLowerCase() !== action.owner.address.toLowerCase()) {
              throw new TransferExecutionError("stale-session");
            }
            await connection.sendCalls(calls, action.id, async () => ownerFence.assertCurrent(generation));
            return action.id;
          }
          if (!sdkSendUserOperation) throw new TransferExecutionError("unavailable");
          ownerFence.assertCurrent(generation);
          const result = await sdkSendUserOperation({
            evmSmartAccount: action.owner.address,
            network: "base",
            calls,
            idempotencyKey: action.id,
          });
          return result.userOperationHash;
        },
        recordHandle: (handle) => postHandle(action.id, generation, { providerHandle: handle }),
      });
    } catch (error) {
      if (error instanceof TransferExecutionError) {
        if (error.reason === "rejected") return { id: action.id, status: "rejected" };
        throw error;
      }
      throw new TransferExecutionError("submission-unknown", error);
    }
    resolveTransaction(action, generation, providerHandle);
    return {
      id: action.id,
      status: "submitted",
      ...(hashPattern.test(providerHandle) ? { userOperationHash: providerHandle as `0x${string}` } : {}),
    };
  }, [assertReady, baseConnection, fetchAccountResource, ownerFence, postHandle, resolveTransaction, sdkSendUserOperation]);

  const fetchOperations = useCallback((signal?: AbortSignal) =>
    fetchAccountResource("/api/actions", { signal }), [fetchAccountResource]);

  const reset = useCallback(() => {
    for (const cancel of resolutionRuns.current.values()) cancel();
    resolutionRuns.current.clear();
    preparedGeneration.current.clear();
    confirmedPlans.current.clear();
    providerDispatches.current.clear();
  }, []);
  useEffect(() => reset, [reset]);

  return {
    fetchOperations,
    prepareMoneyAction,
    resumeMoneyAction,
    executeMoneyAction,
    pendingTransfer: null,
    reset,
  };
}

export function normalizeResolutionState(value: unknown): ResolutionState {
  const status = isRecord(value) ? CDP_STATUS_MAP[String(value.status)] : undefined;
  if (!isRecord(value) || !status) throw new Error("Invalid operation status.");
  const reason = failureReason(value)
    ?? (value.status === "dropped" ? "The operation was dropped before it was included." : null);
  return {
    status,
    ...(typeof value.transactionHash === "string" && hashPattern.test(value.transactionHash)
      ? { transactionHash: value.transactionHash }
      : {}),
    ...(reason ? { reason } : {}),
  };
}

function failureReason(value: Record<string, unknown>): string | null {
  for (const key of ["failureReason", "error", "message"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (isRecord(candidate) && typeof candidate.message === "string" && candidate.message.trim()) {
      return candidate.message.trim();
    }
  }
  return null;
}

function shortFailureReason(reason: string): string {
  const singleLine = reason.replace(/\s+/g, " ").trim();
  return singleLine.length <= 96 ? singleLine : `${singleLine.slice(0, 93)}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export type MoneyActionExecution = ReturnType<typeof useMoneyActionExecution>;

"use client";

import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { AccountSessionStatus, AccountWalletSdkBoundary } from "./cdp-client";
import type { OwnerGenerationFence } from "./cdp-session-lifecycle";
import type { AuthenticatedTransport } from "./cdp-authenticated-transport";
import type { VerifiedAccountSession } from "./session-client";
import type { ConnectedBaseAccount } from "./base-account-connector";
import { executeActionOnce, type ConfirmedPlan } from "./action-dispatch";
import {
  normalizeResolutionState,
  pollTransactionResolution,
} from "./action-resolution";
import type { OperationResult, PreparedMoneyAction } from "@/shared/money-actions/types";
import { TransferExecutionError } from "@/shared/transfers/types";
import { announceActionFailure } from "@/client/home/action-toast-events";

const hashPattern = /^0x[0-9a-fA-F]{64}$/;
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
  verification,
  ownerKey,
  ownerFence,
  sdkSendUserOperation,
  sdkGetUserOperation,
  baseConnection,
  transport,
}: {
  session: VerifiedAccountSession | null;
  status: AccountSessionStatus;
  verification: "provisional" | "server" | null;
  ownerKey: string | null;
  ownerFence: OwnerGenerationFence;
  sdkSendUserOperation: AccountWalletSdkBoundary["sendUserOperation"];
  sdkGetUserOperation: AccountWalletSdkBoundary["getUserOperation"];
  baseConnection: MutableRefObject<ConnectedBaseAccount | null>;
  transport: AuthenticatedTransport;
}) {
  const preparedGeneration = useRef(new Map<string, number>());
  const confirmedPlans = useRef(new Map<string, ConfirmedPlan>());
  const providerDispatches = useRef(new Map<string, Promise<string>>());
  const resolutionRuns = useRef(new Map<string, () => void>());
  const { fetchAccountResource } = transport;

  const assertReady = useCallback(() => {
    if (!session?.smartAccount || !ownerKey || status !== "verified" || verification !== "server") {
      throw new TransferExecutionError("stale-session");
    }
    return session;
  }, [ownerKey, session, status, verification]);

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
    reset,
  };
}

function shortFailureReason(reason: string): string {
  const singleLine = reason.replace(/\s+/g, " ").trim();
  return singleLine.length <= 96 ? singleLine : `${singleLine.slice(0, 93)}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export type MoneyActionExecution = ReturnType<typeof useMoneyActionExecution>;

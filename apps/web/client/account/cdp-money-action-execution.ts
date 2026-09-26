"use client";

import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import { getAddress, isAddress } from "viem";
import type { AccountSessionStatus, AccountWalletClient, AccountWalletSdkBoundary } from "./cdp-client";
import type { OwnerGenerationFence } from "./cdp-session-lifecycle";
import type { AuthenticatedTransport } from "./cdp-authenticated-transport";
import type { VerifiedAccountSession } from "./session-client";
import type { ConnectedBaseAccount } from "./base-account-connector";
import { executeActionOnce, isUserRejectedWalletError, type ConfirmedPlan } from "./action-dispatch";
import {
  normalizeResolutionState,
  pollTransactionResolution,
} from "./action-resolution";
import type { OperationResult, PreparedMoneyAction } from "@/shared/money-actions/types";
import type { TradeConfirmRequest, TradeSigningRequest } from "@/shared/trading/contract";
import { validPrepared } from "@/shared/actions/contracts/prepare";
import { parseMoneyActionNetworkFee, paymasterProxyPath, USDC_PAYMASTER_CONTEXT } from "@/shared/money-actions/network-fee";
import { parsePendingActionResponse } from "@/shared/actions/contracts/get";
import { parseConfirmActionResponse } from "@/shared/actions/contracts/confirm";
import type { HandleActionRequest } from "@/shared/actions/contracts/handle";
import { DECLINE_ACTION_CONTRACT_VERSION, parseDeclineActionResponse, type DeclineActionRequest } from "@/shared/actions/contracts/decline";
import { RETRY_ACTION_CONTRACT_VERSION, parseRetryActionResponse, type RetryActionRequest } from "@/shared/actions/contracts/retry";
import { TransferExecutionError } from "@/shared/transfers/types";
import { announceActionFailure } from "@/client/home/action-toast-events";

const hashPattern = /^0x[0-9a-fA-F]{64}$/;
const permit2Address = "0x000000000022d473030f116ddee9f6b43ac78ba3";
const signaturePattern = /^0x(?:[0-9a-fA-F]{2})+$/;
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
  signTypedData,
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
  signTypedData: AccountWalletClient["signTypedData"];
}) {
  const preparedGeneration = useRef(new Map<string, number>());
  const confirmedPlans = useRef(new Map<string, ConfirmedPlan>());
  const unansweredTradeConfirms = useRef(new Set<string>());
  const providerDispatches = useRef(new Map<string, Promise<string>>());
  const dispatchAttempts = useRef(new Map<string, number>());
  const pendingDeclines = useRef(new Map<string, Promise<void>>());
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
    const resumed = parsePendingActionResponse(value, id, active);
    if (!resumed) throw new TransferExecutionError("unavailable");
    preparedGeneration.current.set(id, generation);
    return resumed;
  }, [assertReady, fetchAccountResource, ownerFence]);

  const postHandle = useCallback(async (
    id: string,
    generation: number,
    body: HandleActionRequest,
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
            evmSmartAccount: getAddress(action.owner.address),
            network: "base",
          });
          return normalizeResolutionState(result);
        }
        const connection = baseConnection.current;
        if (!connection?.getCallsStatus) {
          return { status: "unavailable" };
        }
        return normalizeResolutionState(await connection.getCallsStatus(providerHandle));
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
    const signing = action.kind === "trade" ? action.signing : undefined;
    if (action.kind === "trade" && !validTradeSigning(signing, action.owner)) {
      throw new TransferExecutionError("invalid-request");
    }
    const fee = parseMoneyActionNetworkFee(action.networkFee);
    if (action.networkFee !== undefined && !fee) throw new TransferExecutionError("unavailable");

    let providerHandle: string;
    try {
      providerHandle = await executeActionOnce({
        id: action.id,
        generation,
        fence: ownerFence,
        confirmedPlans: confirmedPlans.current,
        providerDispatches: providerDispatches.current,
        dispatchAttempts: dispatchAttempts.current,
        pendingDeclines: pendingDeclines.current,
        confirm: async () => {
          const postConfirm = async (confirmBody: TradeConfirmRequest | Record<string, never>): Promise<ConfirmedPlan> => {
            const response = parseConfirmActionResponse(
              await fetchAccountResource(`/api/actions/${action.id}/confirm`, { method: "POST", body: confirmBody }),
            );
            ownerFence.assertCurrent(generation);
            if (!response) throw new TransferExecutionError("unavailable");
            return {
              calls: response.calls as ConfirmedPlan["calls"],
              ...(response.batchGasLimit ? { batchGasLimit: response.batchGasLimit } : {}),
            };
          };
          if (action.kind === "trade" && unansweredTradeConfirms.current.has(action.id)) {
            try {
              const replayed = await postConfirm({});
              unansweredTradeConfirms.current.delete(action.id);
              return replayed;
            } catch (error) {
              ownerFence.assertCurrent(generation);
              if (!hasStatus(error, 400)) throw error;
              unansweredTradeConfirms.current.delete(action.id);
            }
          }
          let body: TradeConfirmRequest | Record<string, never> = {};
          if (action.kind === "trade" && signing) {
            let signature: `0x${string}`;
            try {
              signature = await signTypedData(signing.typedData, signing.signer === "cdp-embedded"
                ? { evmAccount: signing.evmAccount, idempotencyKey: action.id }
                : undefined);
            } catch (error) {
              ownerFence.assertCurrent(generation);
              if (isUserRejectedWalletError(error)) throw new TransferExecutionError("rejected", error);
              if (error instanceof TransferExecutionError) throw error;
              throw new TransferExecutionError("not-submitted", error);
            }
            ownerFence.assertCurrent(generation);
            if (!signaturePattern.test(signature)) throw new TransferExecutionError("not-submitted");
            body = { signature } satisfies TradeConfirmRequest;
          }
          if (action.kind === "trade") unansweredTradeConfirms.current.add(action.id);
          const plan = await postConfirm(body);
          unansweredTradeConfirms.current.delete(action.id);
          return plan;
        },
        dispatch: async (plan) => {
          const calls = plan.calls.map((call) => ({ ...call, value: BigInt(call.value) }));
          const paymaster = fee?.payment === "usdc" ? { url: new URL(paymasterProxyPath(action.id), window.location.origin).toString(), context: USDC_PAYMASTER_CONTEXT } : undefined;
          if (action.owner.accountProvider === "base-account") {
            const connection = baseConnection.current;
            if (!connection?.sendCalls || connection.address.toLowerCase() !== action.owner.address.toLowerCase()) {
              throw new TransferExecutionError("stale-session");
            }
            return connection.sendCalls(
              calls,
              action.id,
              async () => ownerFence.assertCurrent(generation),
              plan.batchGasLimit,
              paymaster,
            );
          }
          if (!sdkSendUserOperation) throw new TransferExecutionError("unavailable");
          ownerFence.assertCurrent(generation);
          const result = await sdkSendUserOperation({
            evmSmartAccount: getAddress(action.owner.address),
            network: "base",
            calls,
            idempotencyKey: action.id,
            ...(paymaster ? { paymasterUrl: paymaster.url, paymasterContext: paymaster.context } : {}),
          });
          return result.userOperationHash;
        },
        recordHandle: (handle) => postHandle(action.id, generation, { providerHandle: handle }),
        recordDecline: async (attempt, signal) => {
          ownerFence.assertCurrent(generation);
          const response = await fetchAccountResource(`/api/actions/${action.id}/decline`, {
            method: "POST", signal, body: { version: DECLINE_ACTION_CONTRACT_VERSION, attempt } satisfies DeclineActionRequest,
          });
          if (!parseDeclineActionResponse(response)) throw new TransferExecutionError("unavailable");
          ownerFence.assertCurrent(generation);
        },
        beginRetry: async (attempt) => {
          ownerFence.assertCurrent(generation);
          const response = await fetchAccountResource(`/api/actions/${action.id}/retry`, {
            method: "POST", body: { version: RETRY_ACTION_CONTRACT_VERSION, attempt } satisfies RetryActionRequest,
          });
          if (parseRetryActionResponse(response)?.action.id !== action.id) throw new TransferExecutionError("unavailable");
          ownerFence.assertCurrent(generation);
        },
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
  }, [assertReady, baseConnection, fetchAccountResource, ownerFence, postHandle, resolveTransaction, sdkSendUserOperation, signTypedData]);

  const fetchOperations = useCallback((signal?: AbortSignal) =>
    fetchAccountResource("/api/actions", { signal }), [fetchAccountResource]);

  const reset = useCallback(() => {
    for (const cancel of resolutionRuns.current.values()) cancel();
    resolutionRuns.current.clear();
    preparedGeneration.current.clear();
    confirmedPlans.current.clear();
    unansweredTradeConfirms.current.clear();
    providerDispatches.current.clear();
    dispatchAttempts.current.clear();
    pendingDeclines.current.clear();
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

function validTradeSigning(value: unknown, owner: PreparedMoneyAction["owner"]): value is TradeSigningRequest {
  if (!isRecord(value) || value.signer !== owner.accountProvider || !isRecord(value.typedData)) return false;
  const typedData = value.typedData;
  if (!isRecord(typedData.domain) || !isRecord(typedData.types) || !isRecord(typedData.message) ||
    typedData.domain.chainId !== 8453 || !validAddress(typedData.domain.verifyingContract)) return false;
  if (value.signer === "base-account") {
    return typedData.primaryType === "PermitTransferFrom" && typedData.domain.name === "Permit2" &&
      typedData.domain.verifyingContract.toLowerCase() === permit2Address &&
      Array.isArray(typedData.types.PermitTransferFrom) && Array.isArray(typedData.types.TokenPermissions) &&
      isRecord(typedData.message.permitted) && validAddress(typedData.message.permitted.token) &&
      validAddress(typedData.message.spender) && typeof typedData.message.permitted.amount === "string" &&
      typeof typedData.message.nonce === "string" && typeof typedData.message.deadline === "string";
  }
  return value.signer === "cdp-embedded" && validAddress(value.evmAccount) &&
    value.evmAccount.toLowerCase() !== owner.address.toLowerCase() &&
    typedData.primaryType === "CoinbaseSmartWalletMessage" && typedData.domain.name === "Coinbase Smart Wallet" &&
    typedData.domain.version === "1" && typedData.domain.verifyingContract.toLowerCase() === owner.address.toLowerCase() &&
    Array.isArray(typedData.types.CoinbaseSmartWalletMessage) &&
    typeof typedData.message.hash === "string" && hashPattern.test(typedData.message.hash);
}

function validAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && isAddress(value);
}

function shortFailureReason(reason: string): string {
  const singleLine = reason.replace(/\s+/g, " ").trim();
  return singleLine.length <= 96 ? singleLine : `${singleLine.slice(0, 93)}…`;
}

function hasStatus(error: unknown, status: number): boolean {
  return isRecord(error) && error.status === status;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

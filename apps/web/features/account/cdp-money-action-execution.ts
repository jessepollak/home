"use client";
/* eslint-disable react-hooks/exhaustive-deps -- refs moved behind capability hooks retain the original stable identities. */

import { useCallback, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import type { GetUserOperationResult } from "@coinbase/cdp-core";
import type { AccountSessionStatus, AccountWalletSdkBoundary } from "./cdp-client";
import type { OwnerGenerationFence } from "./cdp-session-lifecycle";
import type { AuthenticatedTransport } from "./cdp-authenticated-transport";
import type { SessionFetch, VerifiedAccountSession } from "./session-client";
import { ACCOUNT_PROVIDER_HEADER, BASE_CHAIN_ID } from "./session-types";
import type { ConnectedBaseAccount } from "./base-account-connector";
import { BaseAccountConnectorError } from "./base-account-connector";
import { parsePortfolioSnapshot } from "@/features/portfolio/parse";
import {
  claimMoneyAction,
  readMoneyAction,
  recordMoneyActionStatus,
  recordMoneyActionSubmission,
  type MoneyActionApiFetch,
} from "@/features/money-actions/client";
import type { OperationResult, PreparedMoneyAction } from "@/features/money-actions/types";
import type { ProviderHandleJournal } from "@/features/money-actions/provider-handle-journal";
import { recoverJournaledProviderHandle } from "@/features/money-actions/provider-handle-recovery";
import type { StoredMoneyActionOperation } from "@/server/money-actions/store";
import { assertTransferRequest, buildTransferCall, findTransferBalance } from "@/features/transfers/transfer-helpers";
import { TransferExecutionError, type ConfirmedTransfer, type PendingTransfer, type TransferRequest } from "@/features/transfers/types";

const transactionHashPattern = /^0x[0-9a-fA-F]{64}$/;
const decimalIntegerPattern = /^(?:0|[1-9][0-9]*)$/;
const TRANSFER_CONFIRMATION_TIMEOUT_MS = 120_000;
const TRANSFER_CONFIRMATION_POLL_MS = 1_500;

function transferBoundaryKey(
  ownerKey: string,
  session: VerifiedAccountSession,
): string | null {
  return session.smartAccount
    ? `${ownerKey}\u0000${session.user.subject}\u0000${session.smartAccount.address}\u0000${session.accountProvider}`
    : null;
}

function normalizeTransactionHash(value: unknown): `0x${string}` {
  if (typeof value !== "string" || !transactionHashPattern.test(value)) {
    throw new TransferExecutionError("failed");
  }
  return value.toLowerCase() as `0x${string}`;
}

function operationResult(operation: StoredMoneyActionOperation): OperationResult {
  return {
    id: operation.action.id,
    status: operation.status,
    ...(operation.transactionHash ? { transactionHash: operation.transactionHash } : {}),
    ...(operation.userOperationHash ? { userOperationHash: operation.userOperationHash } : {}),
  };
}

function isMoneyActionOwnedBySession(
  action: PreparedMoneyAction,
  session: VerifiedAccountSession,
): boolean {
  return Boolean(
    session.smartAccount &&
    action.owner.subject === session.user.subject &&
    action.owner.address.toLowerCase() === session.smartAccount.address.toLowerCase() &&
    action.owner.chainId === BASE_CHAIN_ID &&
    action.owner.accountProvider === session.accountProvider
  );
}

async function sameProviderCalls(
  actual: unknown,
  expected: PreparedMoneyAction["calls"],
): Promise<boolean> {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  for (const [index, value] of actual.entries()) {
    const wanted = expected[index];
    if (
      !isRecord(value) ||
      typeof value.to !== "string" ||
      !/^0x[0-9a-fA-F]{40}$/.test(value.to) ||
      (value.data !== undefined && (typeof value.data !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value.data)))
    ) return false;
    const data = (value.data ?? "0x").toLowerCase();
    let dataMatches = data === wanted.data.toLowerCase();
    if (wanted.dataHash) {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
      const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      dataMatches = hex === wanted.dataHash;
    }
    const rawValue = value.value;
    if (typeof rawValue !== "string" || !decimalIntegerPattern.test(rawValue)) return false;
    if (
      value.to.toLowerCase() !== wanted.to.toLowerCase() ||
      !dataMatches ||
      BigInt(rawValue) !== BigInt(wanted.value)
    ) return false;
  }
  return true;
}

const embeddedOperationStatuses = new Set([
  "pending", "signed", "broadcast", "complete", "dropped", "failed",
]);

type EmbeddedMoneyActionObservation = {
  status: "pending" | "complete" | "dropped" | "failed";
  transactionHash?: `0x${string}`;
};

async function parseEmbeddedMoneyActionObservation(
  value: unknown,
  expectedUserOperationHash: `0x${string}`,
  expectedCalls: PreparedMoneyAction["calls"],
): Promise<EmbeddedMoneyActionObservation> {
  if (
    !isRecord(value) ||
    value.network !== "base" ||
    typeof value.userOpHash !== "string" ||
    typeof value.status !== "string" ||
    !embeddedOperationStatuses.has(value.status) ||
    !(await sameProviderCalls(value.calls, expectedCalls)) ||
    (value.receipts !== undefined && !Array.isArray(value.receipts))
  ) {
    throw new TransferExecutionError("submission-unknown");
  }
  let observedUserOperationHash: `0x${string}`;
  try {
    observedUserOperationHash = normalizeTransactionHash(value.userOpHash);
  } catch {
    throw new TransferExecutionError("submission-unknown");
  }
  if (observedUserOperationHash !== expectedUserOperationHash) {
    throw new TransferExecutionError("submission-unknown");
  }

  let transactionHash: `0x${string}` | undefined;
  if (value.transactionHash !== undefined) {
    const pendingEmptyHash =
      value.transactionHash === "" &&
      (value.status === "pending" || value.status === "broadcast");
    if (!pendingEmptyHash) {
      try {
        transactionHash = normalizeTransactionHash(value.transactionHash);
      } catch {
        throw new TransferExecutionError("submission-unknown");
      }
    }
  }

  let reverted = false;
  if (Array.isArray(value.receipts)) {
    for (const receipt of value.receipts) {
      if (!isRecord(receipt)) throw new TransferExecutionError("submission-unknown");
      if (receipt.transactionHash !== undefined) {
        let receiptHash: `0x${string}`;
        try {
          receiptHash = normalizeTransactionHash(receipt.transactionHash);
        } catch {
          throw new TransferExecutionError("submission-unknown");
        }
        if (transactionHash && receiptHash !== transactionHash) {
          throw new TransferExecutionError("submission-unknown");
        }
      }
      if (receipt.revert !== undefined) {
        if (
          !isRecord(receipt.revert) ||
          typeof receipt.revert.data !== "string" ||
          !/^0x[0-9a-fA-F]*$/.test(receipt.revert.data) ||
          typeof receipt.revert.message !== "string"
        ) {
          throw new TransferExecutionError("submission-unknown");
        }
        reverted = true;
      }
    }
  }

  if (value.status === "failed" || reverted) return { status: "failed", ...(transactionHash ? { transactionHash } : {}) };
  if (value.status === "dropped") return { status: "dropped", ...(transactionHash ? { transactionHash } : {}) };
  if (value.status === "complete" && transactionHash) return { status: "complete", transactionHash };
  return { status: "pending", ...(transactionHash ? { transactionHash } : {}) };
}

function transferError(error: unknown): TransferExecutionError {
  if (error instanceof TransferExecutionError) {
    return error;
  }
  if (
    error instanceof BaseAccountConnectorError &&
    error.reason === "cancelled"
  ) {
    return new TransferExecutionError("rejected", error);
  }
  return new TransferExecutionError("failed", error);
}

class MoneyActionExpiredBeforeDispatchError extends Error {
  constructor() {
    super("money-action-expired-before-dispatch");
    this.name = "MoneyActionExpiredBeforeDispatchError";
  }
}

function assertMoneyActionDispatchable(
  action: PreparedMoneyAction,
  assertActive: () => void,
): void {
  assertActive();
  const expiresAt = Date.parse(action.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new MoneyActionExpiredBeforeDispatchError();
  }
}

function waitForPoll(): Promise<void> {
  return new Promise((resolve) =>
    window.setTimeout(resolve, TRANSFER_CONFIRMATION_POLL_MS),
  );
}

async function waitForEmbeddedTransactionCandidate(
  userOperationHash: `0x${string}`,
  smartAccount: `0x${string}`,
  getOperation: NonNullable<AccountWalletSdkBoundary["getUserOperation"]>,
  assertActive: () => void,
  expectedCalls?: PreparedMoneyAction["calls"],
  failOnProviderUnavailable = false,
): Promise<{ transactionHash: `0x${string}`; deadline: number }> {
  const normalizedUserOperationHash = normalizeTransactionHash(userOperationHash);
  const deadline = Date.now() + TRANSFER_CONFIRMATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    assertActive();
    let result: GetUserOperationResult;
    try {
      result = await getOperation({
        userOperationHash: normalizedUserOperationHash,
        evmSmartAccount: smartAccount,
        network: "base",
      });
    } catch {
      if (failOnProviderUnavailable) throw new TransferExecutionError("unavailable");
      await waitForPoll();
      continue;
    }
    assertActive();
    if (expectedCalls) {
      const observation = await parseEmbeddedMoneyActionObservation(
        result,
        normalizedUserOperationHash,
        expectedCalls,
      );
      if (observation.status === "failed") throw new TransferExecutionError("failed");
      if (observation.status === "dropped") throw new TransferExecutionError("submission-unknown");
      if (observation.status === "complete" && observation.transactionHash) {
        return { transactionHash: observation.transactionHash, deadline };
      }
    } else {
      if (
        result.status === "failed" ||
        result.receipts?.some((receipt) => receipt.revert !== undefined)
      ) {
        throw new TransferExecutionError("failed");
      }
      if (result.status === "dropped") throw new TransferExecutionError("submission-unknown");
      if (result.status === "complete") {
        try {
          return { transactionHash: normalizeTransactionHash(result.transactionHash), deadline };
        } catch {
          await waitForPoll();
          continue;
        }
      }
    }
    await waitForPoll();
  }
  throw new TransferExecutionError("confirmation-timeout");
}

async function waitForEmbeddedReceipt(
  userOperationHash: `0x${string}`,
  smartAccount: `0x${string}`,
  getOperation: NonNullable<AccountWalletSdkBoundary["getUserOperation"]>,
  accountProvider: VerifiedAccountSession["accountProvider"],
  getAccessToken: () => Promise<string | null>,
  sessionFetch: SessionFetch | undefined,
  assertActive: () => void,
  expectedCalls?: PreparedMoneyAction["calls"],
): Promise<`0x${string}`> {
  const candidate = await waitForEmbeddedTransactionCandidate(
    userOperationHash,
    smartAccount,
    getOperation,
    assertActive,
    expectedCalls,
  );
  return waitForBaseReceipt(
    candidate.transactionHash,
    accountProvider,
    getAccessToken,
    sessionFetch,
    assertActive,
    candidate.deadline,
    {
      userOperationHash: normalizeTransactionHash(userOperationHash),
      sender: smartAccount,
    },
  );
}

type MoneyActionSubmissionReference = {
  submissionId?: string;
  transactionHash?: `0x${string}`;
  userOperationHash?: `0x${string}`;
};

async function acknowledgeRecoveredMoneyActionSubmission(
  fetchApi: MoneyActionApiFetch,
  action: PreparedMoneyAction,
  reference: MoneyActionSubmissionReference,
  assertActive: () => void,
): Promise<StoredMoneyActionOperation> {
  let operation: StoredMoneyActionOperation;
  try {
    operation = await recordMoneyActionSubmission(fetchApi, action.id, reference, action);
    assertActive();
  } catch (error) {
    if (errorStatus(error) !== 409) throw error;
    operation = await readMoneyAction(fetchApi, action.id, action);
    assertActive();
  }
  if (!submissionReferenceMatches(operation, reference)) {
    throw new TransferExecutionError("submission-unknown");
  }
  return operation;
}

function submissionReferenceMatches(
  operation: StoredMoneyActionOperation,
  reference: MoneyActionSubmissionReference,
): boolean {
  return (
    (reference.submissionId === undefined || operation.submissionId === reference.submissionId) &&
    (reference.transactionHash === undefined || operation.transactionHash === reference.transactionHash) &&
    (reference.userOperationHash === undefined || operation.userOperationHash === reference.userOperationHash)
  );
}

function errorStatus(error: unknown): number | null {
  return error && typeof error === "object" && "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
    ? (error as { status: number }).status
    : null;
}

async function waitForBaseReceipt(
  transactionHash: `0x${string}`,
  accountProvider: VerifiedAccountSession["accountProvider"],
  getAccessToken: () => Promise<string | null>,
  sessionFetch: SessionFetch | undefined,
  assertActive: () => void,
  deadline = Date.now() + TRANSFER_CONFIRMATION_TIMEOUT_MS,
  operation?: { userOperationHash: `0x${string}`; sender: `0x${string}` },
): Promise<`0x${string}`> {
  const normalizedHash = normalizeTransactionHash(transactionHash);
  const parameters = new URLSearchParams({ hash: normalizedHash });
  if (operation) {
    parameters.set("userOpHash", operation.userOperationHash);
    parameters.set("sender", operation.sender);
  }
  while (Date.now() < deadline) {
    assertActive();
    const accessToken = await getAccessToken();
    assertActive();
    if (!accessToken) {
      throw new TransferExecutionError("stale-session");
    }

    let response: Response;
    try {
      response = await (sessionFetch ?? fetch)(
        `/api/transfer-receipt?${parameters.toString()}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
            [ACCOUNT_PROVIDER_HEADER]: accountProvider,
          },
          cache: "no-store",
          credentials: "same-origin",
        },
      );
    } catch {
      await waitForPoll();
      continue;
    }
    assertActive();
    if (!response.ok) {
      await waitForPoll();
      continue;
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      await waitForPoll();
      continue;
    }
    assertActive();
    if (!isRecord(payload) || payload.transactionHash !== normalizedHash) {
      await waitForPoll();
      continue;
    }
    if (payload.status === "confirmed") {
      if (payload.success !== true) {
        throw new TransferExecutionError("failed");
      }
      return normalizedHash;
    }
    if (payload.status !== "pending" && payload.status !== "unresolved") {
      await waitForPoll();
      continue;
    }
    await waitForPoll();
  }
  throw new TransferExecutionError("confirmation-timeout");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function useMoneyActionExecution({
  session,
  status,
  ownerKey,
  ownerFence,
  sdkSendUserOperation,
  sdkGetUserOperation,
  getAccessToken,
  sessionFetch,
  baseConnection,
  providerHandleJournal,
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
  baseConnection: MutableRefObject<ConnectedBaseAccount | null>;
  providerHandleJournal: ProviderHandleJournal;
  transport: AuthenticatedTransport;
}) {
  const { fetchPortfolio, fetchMoneyActionApi } = transport;
  const [pendingTransfer, setPendingTransfer] = useState<PendingTransfer | null>(null);
  const pendingTransferRef = useRef<PendingTransfer | null>(null);
  const transferSequence = useRef(0);
  const transferInProgress = useRef(false);

  const updatePendingTransfer = useCallback((value: PendingTransfer | null) => {
    pendingTransferRef.current = value;
    setPendingTransfer(value);
  }, []);

  const visibleTransferBoundary =
    session && ownerKey ? transferBoundaryKey(ownerKey, session) : null;
  const currentTransferBoundary = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (currentTransferBoundary.current !== visibleTransferBoundary) {
      transferSequence.current += 1;
      transferInProgress.current = false;
      updatePendingTransfer(null);
      currentTransferBoundary.current = visibleTransferBoundary;
    }
  }, [updatePendingTransfer, visibleTransferBoundary]);

  const reset = useCallback(() => {
    transferSequence.current += 1;
    transferInProgress.current = false;
    updatePendingTransfer(null);
  }, [updatePendingTransfer]);

  const fetchOperations = useCallback(
    (signal?: AbortSignal) => fetchMoneyActionApi("/api/actions/operations", { method: "GET", signal }),
    [fetchMoneyActionApi],
  );
  const prepareMoneyAction = useCallback(
    async (endpoint: string, input: unknown): Promise<PreparedMoneyAction> => {
      const value = await fetchMoneyActionApi(endpoint, {
        method: "POST",
        body: JSON.stringify(input),
      });
      if (
        !isRecord(value) ||
        typeof value.id !== "string" ||
        typeof value.reviewHash !== "string" ||
        !isRecord(value.owner) ||
        !session?.smartAccount ||
        value.owner.subject !== session.user.subject ||
        typeof value.owner.address !== "string" ||
        value.owner.address.toLowerCase() !== session.smartAccount.address.toLowerCase() ||
        value.owner.chainId !== BASE_CHAIN_ID ||
        value.owner.accountProvider !== session.accountProvider ||
        !Array.isArray(value.calls) ||
        !Array.isArray(value.amounts) ||
        !Array.isArray(value.warnings)
      ) {
        throw new TransferExecutionError("unavailable");
      }
      return value as unknown as PreparedMoneyAction;
    },
    [fetchMoneyActionApi, session],
  );

  const recoverBaseMoneyAction = useCallback(
    async (
      operation: StoredMoneyActionOperation,
      prepared: PreparedMoneyAction,
      connection: ConnectedBaseAccount,
      assertStillActive: () => void,
    ): Promise<OperationResult> => {
      const submissionId = operation.submissionId;
      if (!submissionId || !connection.getCallsStatus) {
        throw new TransferExecutionError("submission-unknown");
      }
      const deadline = Date.now() + TRANSFER_CONFIRMATION_TIMEOUT_MS;
      while (Date.now() < deadline) {
        assertStillActive();
        let result: Awaited<ReturnType<NonNullable<ConnectedBaseAccount["getCallsStatus"]>>>;
        try {
          result = await connection.getCallsStatus(submissionId);
        } catch {
          if (operation.status === "included") {
            assertStillActive();
            return operationResult(operation);
          }
          await waitForPoll();
          continue;
        }
        assertStillActive();
        if (result.status === "failed") {
          if (operation.status === "included") return operationResult(operation);
          return operationResult(
            await recordMoneyActionStatus(fetchMoneyActionApi, prepared.id, "unknown"),
          );
        }
        if (result.status === "complete") {
          const acknowledged = await acknowledgeRecoveredMoneyActionSubmission(
            fetchMoneyActionApi,
            prepared,
            { submissionId, transactionHash: result.transactionHash },
            assertStillActive,
          );
          if (["confirmed", "failed", "rejected", "expired"].includes(acknowledged.status)) {
            return operationResult(acknowledged);
          }
          await waitForBaseReceipt(
            result.transactionHash,
            "base-account",
            getAccessToken,
            sessionFetch,
            assertStillActive,
            deadline,
          );
          return operationResult(
            await readMoneyAction(fetchMoneyActionApi, prepared.id, prepared),
          );
        }
        await waitForPoll();
      }
      throw new TransferExecutionError("confirmation-timeout");
    },
    [fetchMoneyActionApi, getAccessToken, sessionFetch],
  );

  const reconcileRecordedMoneyAction = useCallback(
    async (
      operation: StoredMoneyActionOperation,
      prepared: PreparedMoneyAction,
      assertStillActive: () => void,
      markReferenceFreeSubmittingUnknown: boolean,
    ): Promise<OperationResult> => {
      if (["prepared", "confirmed", "failed", "rejected", "expired"].includes(operation.status)) {
        return operationResult(operation);
      }
      if (operation.transactionHash) {
        await waitForBaseReceipt(
          operation.transactionHash,
          prepared.owner.accountProvider,
          getAccessToken,
          sessionFetch,
          assertStillActive,
          undefined,
          operation.userOperationHash
            ? { userOperationHash: operation.userOperationHash, sender: prepared.owner.address }
            : undefined,
        );
        return operationResult(await readMoneyAction(fetchMoneyActionApi, prepared.id, prepared));
      }
      if (operation.userOperationHash && sdkGetUserOperation) {
        let candidate: { transactionHash: `0x${string}`; deadline: number };
        try {
          candidate = await waitForEmbeddedTransactionCandidate(
            operation.userOperationHash,
            prepared.owner.address,
            sdkGetUserOperation,
            assertStillActive,
            prepared.calls,
            operation.status === "included",
          );
        } catch (error) {
          if (
            operation.status === "included" &&
            error instanceof TransferExecutionError &&
            (error.reason === "failed" || error.reason === "unavailable")
          ) {
            assertStillActive();
            return operationResult(operation);
          }
          throw error;
        }
        const acknowledged = await acknowledgeRecoveredMoneyActionSubmission(
          fetchMoneyActionApi,
          prepared,
          {
            userOperationHash: operation.userOperationHash,
            transactionHash: candidate.transactionHash,
          },
          assertStillActive,
        );
        if (["confirmed", "failed", "rejected", "expired"].includes(acknowledged.status)) {
          return operationResult(acknowledged);
        }
        await waitForBaseReceipt(
          candidate.transactionHash,
          prepared.owner.accountProvider,
          getAccessToken,
          sessionFetch,
          assertStillActive,
          candidate.deadline,
          { userOperationHash: operation.userOperationHash, sender: prepared.owner.address },
        );
        return operationResult(
          await readMoneyAction(fetchMoneyActionApi, prepared.id, prepared),
        );
      }
      if (operation.submissionId && baseConnection.current?.getCallsStatus) {
        return recoverBaseMoneyAction(
          operation,
          prepared,
          baseConnection.current,
          assertStillActive,
        );
      }
      if (markReferenceFreeSubmittingUnknown && operation.status === "submitting") {
        return operationResult(
          await recordMoneyActionStatus(fetchMoneyActionApi, prepared.id, "unknown"),
        );
      }
      return operationResult(operation);
    },
    [
      fetchMoneyActionApi,
      getAccessToken,
      recoverBaseMoneyAction,
      sdkGetUserOperation,
      sessionFetch,
    ],
  );

  const checkMoneyAction = useCallback(
    async (action: PreparedMoneyAction): Promise<OperationResult> => {
      if (
        transferInProgress.current ||
        !session?.smartAccount ||
        !ownerKey ||
        status !== "verified" ||
        !isMoneyActionOwnedBySession(action, session)
      ) {
        throw new TransferExecutionError("stale-session");
      }
      const boundary = transferBoundaryKey(ownerKey, session);
      if (!boundary || currentTransferBoundary.current !== boundary) {
        throw new TransferExecutionError("stale-session");
      }
      const sequence = transferSequence.current;
      const ownerIdentity = ownerFence.capture(ownerKey, boundary);
      const assertActive = () => {
        if (!ownerFence.isCurrent(ownerIdentity) || transferSequence.current !== sequence || currentTransferBoundary.current !== boundary) {
          throw new TransferExecutionError("stale-session");
        }
      };
      transferInProgress.current = true;
      try {
        let operation = await readMoneyAction(fetchMoneyActionApi, action.id, action);
        assertActive();
        if (!isMoneyActionOwnedBySession(operation.action, session)) {
          throw new TransferExecutionError("stale-session");
        }
        const journalRecovery = await recoverJournaledProviderHandle({
          fetchApi: fetchMoneyActionApi,
          journal: providerHandleJournal,
          action: operation.action,
          operation,
          assertActive,
        });
        operation = journalRecovery.operation;
        if (["retained", "conflict", "inconsistent"].includes(journalRecovery.kind)) {
          return operationResult(operation);
        }
        return await reconcileRecordedMoneyAction(
          operation,
          operation.action,
          assertActive,
          false,
        );
      } finally {
        if (transferSequence.current === sequence) transferInProgress.current = false;
      }
    },
    [fetchMoneyActionApi, ownerKey, providerHandleJournal, reconcileRecordedMoneyAction, session, status],
  );

  const executeMoneyAction = useCallback(
    async (action: PreparedMoneyAction): Promise<OperationResult> => {
      if (
        transferInProgress.current ||
        !session?.smartAccount ||
        !ownerKey ||
        status !== "verified" ||
        !isMoneyActionOwnedBySession(action, session)
      ) {
        throw new TransferExecutionError("stale-session");
      }
      const boundary = transferBoundaryKey(ownerKey, session);
      if (!boundary || currentTransferBoundary.current !== boundary) {
        throw new TransferExecutionError("stale-session");
      }
      const sequence = transferSequence.current;
      const ownerIdentity = ownerFence.capture(ownerKey, boundary);
      const assertActive = () => {
        if (!ownerFence.isCurrent(ownerIdentity) || transferSequence.current !== sequence || currentTransferBoundary.current !== boundary) {
          throw new TransferExecutionError("stale-session");
        }
      };
      transferInProgress.current = true;
      try {
        let durable = await readMoneyAction(fetchMoneyActionApi, action.id, action);
        assertActive();
        if (!isMoneyActionOwnedBySession(durable.action, session)) {
          throw new TransferExecutionError("stale-session");
        }
        const journalRecovery = await recoverJournaledProviderHandle({
          fetchApi: fetchMoneyActionApi,
          journal: providerHandleJournal,
          action: durable.action,
          operation: durable,
          assertActive,
        });
        durable = journalRecovery.operation;
        if (["retained", "conflict", "inconsistent"].includes(journalRecovery.kind)) {
          return operationResult(durable);
        }
        if (["confirmed", "failed", "rejected", "expired"].includes(durable.status)) {
          return operationResult(durable);
        }
        if (durable.status === "prepared" && journalRecovery.issues.includes("storage-corrupt")) {
          throw new TransferExecutionError("unavailable");
        }
        if (durable.status === "prepared" && !providerHandleJournal.canRetain()) {
          throw new TransferExecutionError("unavailable");
        }

        if (durable.status === "prepared" && action.kind === "send") {
          const spend = action.amounts.find((amount) => amount.direction === "spend");
          if (!spend || (spend.assetId !== "usdc" && spend.assetId !== "eth")) {
            throw new TransferExecutionError("invalid-request");
          }
          if (session.accountProvider === "base-account") {
            const connection = baseConnection.current;
            if (
              !connection ||
              !connection.sendCalls ||
              !connection.getCallsStatus ||
              connection.address.toLowerCase() !== session.smartAccount.address.toLowerCase()
            ) {
              throw new TransferExecutionError("stale-session");
            }
          } else if (!sdkSendUserOperation || !sdkGetUserOperation) {
            throw new TransferExecutionError("unavailable");
          }
          const portfolio = parsePortfolioSnapshot(await fetchPortfolio(), {
            subject: session.user.subject,
            smartAccountAddress: session.smartAccount.address,
            chainId: BASE_CHAIN_ID,
          });
          assertActive();
          if (BigInt(spend.amountBaseUnits) > findTransferBalance(portfolio.assets, spend.assetId)) {
            throw new TransferExecutionError("insufficient-balance");
          }
        }

        const claim = await claimMoneyAction(fetchMoneyActionApi, action);
        assertActive();
        const canonicalAction = claim.action;
        if (claim.disposition === "recover") {
          return await reconcileRecordedMoneyAction(
            claim.operation,
            canonicalAction,
            assertActive,
            true,
          );
        }

        const calls = canonicalAction.calls.map((call) => ({
          to: call.to,
          data: call.data,
          value: BigInt(call.value),
        }));
        assertActive();
        // Freeze the reviewed owner/action/provider binding before crossing the wallet boundary.
        const providerHandleBinding = structuredClone(canonicalAction);

        if (session.accountProvider === "base-account") {
          const connection = baseConnection.current;
          if (
            !connection ||
            !connection.sendCalls ||
            !connection.getCallsStatus ||
            connection.address.toLowerCase() !== session.smartAccount.address.toLowerCase()
          ) {
            await recordMoneyActionStatus(fetchMoneyActionApi, canonicalAction.id, "failed");
            throw new TransferExecutionError("stale-session");
          }
          let submissionId: string;
          try {
            submissionId = await connection.sendCalls(
              calls,
              canonicalAction.id,
              async () => assertMoneyActionDispatchable(canonicalAction, assertActive),
            );
          } catch (error) {
            if (error instanceof MoneyActionExpiredBeforeDispatchError) {
              return operationResult(
                await recordMoneyActionStatus(fetchMoneyActionApi, canonicalAction.id, "expired"),
              );
            }
            if (error instanceof TransferExecutionError) {
              throw error;
            }
            if (error instanceof BaseAccountConnectorError && error.reason === "cancelled") {
              await recordMoneyActionStatus(fetchMoneyActionApi, canonicalAction.id, "rejected");
              throw new TransferExecutionError("rejected", error);
            }
            await recordMoneyActionStatus(fetchMoneyActionApi, canonicalAction.id, "unknown");
            throw new TransferExecutionError("submission-unknown", error);
          }
          const retained = providerHandleJournal.retain(providerHandleBinding, {
            kind: "submission-id",
            provider: "base-account",
            value: submissionId,
          });
          if (!retained.retained) {
            throw new TransferExecutionError("submission-unknown");
          }
          await providerHandleJournal.persist(retained.entry!);
          assertActive();
          const journaled = await recoverJournaledProviderHandle({
            fetchApi: fetchMoneyActionApi,
            journal: providerHandleJournal,
            action: providerHandleBinding,
            operation: claim.operation,
            assertActive,
          });
          if (journaled.kind !== "acknowledged") {
            throw new TransferExecutionError("submission-unknown");
          }
          if (["confirmed", "failed", "rejected", "expired"].includes(journaled.operation.status)) {
            return operationResult(journaled.operation);
          }
          return await recoverBaseMoneyAction(
            journaled.operation,
            canonicalAction,
            connection,
            assertActive,
          );
        }

        if (!sdkSendUserOperation || !sdkGetUserOperation) {
          await recordMoneyActionStatus(fetchMoneyActionApi, canonicalAction.id, "failed");
          throw new TransferExecutionError("unavailable");
        }
        try {
          assertMoneyActionDispatchable(canonicalAction, assertActive);
        } catch (error) {
          if (error instanceof MoneyActionExpiredBeforeDispatchError) {
            return operationResult(
              await recordMoneyActionStatus(fetchMoneyActionApi, canonicalAction.id, "expired"),
            );
          }
          throw error;
        }
        let userOperationHash: `0x${string}`;
        try {
          const submission = await sdkSendUserOperation({
            evmSmartAccount: session.smartAccount.address,
            network: "base",
            calls,
            idempotencyKey: canonicalAction.id,
          });
          userOperationHash = normalizeTransactionHash(submission.userOperationHash);
        } catch (error) {
          await recordMoneyActionStatus(fetchMoneyActionApi, canonicalAction.id, "unknown");
          throw new TransferExecutionError("submission-unknown", error);
        }
        const retained = providerHandleJournal.retain(providerHandleBinding, {
          kind: "user-operation-hash",
          provider: "cdp-embedded",
          value: userOperationHash,
        });
        if (!retained.retained) {
          throw new TransferExecutionError("submission-unknown");
        }
        await providerHandleJournal.persist(retained.entry!);
        assertActive();
        const journaled = await recoverJournaledProviderHandle({
          fetchApi: fetchMoneyActionApi,
          journal: providerHandleJournal,
          action: providerHandleBinding,
          operation: claim.operation,
          assertActive,
        });
        if (journaled.kind !== "acknowledged") {
          throw new TransferExecutionError("submission-unknown");
        }
        if (["confirmed", "failed", "rejected", "expired"].includes(journaled.operation.status)) {
          return operationResult(journaled.operation);
        }
        return await reconcileRecordedMoneyAction(
          journaled.operation,
          canonicalAction,
          assertActive,
          false,
        );
      } finally {
        if (transferSequence.current === sequence) transferInProgress.current = false;
      }
    },
    [
      fetchMoneyActionApi,
      fetchPortfolio,
      ownerKey,
      providerHandleJournal,
      reconcileRecordedMoneyAction,
      recoverBaseMoneyAction,
      sdkGetUserOperation,
      sdkSendUserOperation,
      session,
      status,
    ],
  );

  const confirmPendingTransfer = useCallback(
    async (
      handle: PendingTransfer,
      assertActive: () => void,
    ): Promise<ConfirmedTransfer> => {
      try {
        let transactionHash: `0x${string}`;
        if (handle.userOperationHash) {
          if (!sdkGetUserOperation || !session?.smartAccount) {
            throw new TransferExecutionError("unavailable");
          }
          transactionHash = await waitForEmbeddedReceipt(
            handle.userOperationHash,
            session.smartAccount.address,
            sdkGetUserOperation,
            handle.provider,
            getAccessToken,
            sessionFetch,
            assertActive,
          );
        } else if (handle.transactionHash) {
          transactionHash = await waitForBaseReceipt(
            handle.transactionHash,
            handle.provider,
            getAccessToken,
            sessionFetch,
            assertActive,
          );
        } else {
          throw new TransferExecutionError("submission-unknown");
        }
        updatePendingTransfer(null);
        return {
          assetId: handle.assetId,
          recipient: handle.recipient,
          amountBaseUnits: handle.amountBaseUnits,
          transactionHash,
        };
      } catch (error) {
        const normalized = transferError(error);
        if (normalized.reason === "failed") {
          updatePendingTransfer(null);
        } else if (normalized.reason === "submission-unknown") {
          updatePendingTransfer({ ...handle, state: "unknown" });
        }
        throw normalized;
      }
    },
    [getAccessToken, sdkGetUserOperation, session, sessionFetch, updatePendingTransfer],
  );

  const sendTransfer = useCallback(
    async (request: TransferRequest, intentId: string): Promise<ConfirmedTransfer> => {
      assertTransferRequest(request);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(intentId)) {
        throw new TransferExecutionError("invalid-request");
      }
      if (
        transferInProgress.current ||
        pendingTransferRef.current ||
        !session?.smartAccount ||
        !ownerKey ||
        status !== "verified" ||
        session.smartAccount.chainId !== BASE_CHAIN_ID
      ) {
        throw new TransferExecutionError(
          pendingTransferRef.current ? "submission-pending" : "unavailable",
        );
      }

      const boundary = transferBoundaryKey(ownerKey, session);
      if (!boundary || currentTransferBoundary.current !== boundary) {
        throw new TransferExecutionError("stale-session");
      }
      const sequence = transferSequence.current;
      const ownerIdentity = ownerFence.capture(ownerKey, boundary);
      const assertActive = () => {
        if (
          !ownerFence.isCurrent(ownerIdentity) ||
          transferSequence.current !== sequence ||
          currentTransferBoundary.current !== boundary
        ) {
          throw new TransferExecutionError("stale-session");
        }
      };

      transferInProgress.current = true;
      let dispatched = false;
      let handle: PendingTransfer | null = null;
      try {
        assertActive();
        const portfolioPayload = await fetchPortfolio();
        assertActive();
        const portfolio = parsePortfolioSnapshot(portfolioPayload, {
          subject: session.user.subject,
          smartAccountAddress: session.smartAccount.address,
          chainId: BASE_CHAIN_ID,
        });
        const balance = findTransferBalance(portfolio.assets, request.assetId);
        if (BigInt(request.amountBaseUnits) > balance) {
          throw new TransferExecutionError("insufficient-balance");
        }

        const call = buildTransferCall(request);

        if (session.accountProvider === "base-account") {
          const connection = baseConnection.current;
          if (
            !connection ||
            connection.address.toLowerCase() !== session.smartAccount.address.toLowerCase() ||
            !connection.sendTransaction
          ) {
            throw new TransferExecutionError("stale-session");
          }
          await connection.assertUnchanged();
          assertActive();
          handle = {
            ...request,
            intentId,
            provider: session.accountProvider,
            state: "unknown",
          };
          updatePendingTransfer(handle);
          dispatched = true;
          const transactionHash = normalizeTransactionHash(
            await connection.sendTransaction(call),
          );
          handle = { ...handle, state: "submitted", transactionHash };
          updatePendingTransfer(handle);
          await connection.assertUnchanged();
          assertActive();
        } else {
          if (!sdkSendUserOperation || !sdkGetUserOperation) {
            throw new TransferExecutionError("unavailable");
          }
          handle = {
            ...request,
            intentId,
            provider: session.accountProvider,
            state: "unknown",
          };
          updatePendingTransfer(handle);
          dispatched = true;
          const submission = await sdkSendUserOperation({
            evmSmartAccount: session.smartAccount.address,
            network: "base",
            calls: [call],
            idempotencyKey: intentId,
          });
          const userOperationHash = normalizeTransactionHash(
            submission.userOperationHash,
          );
          handle = { ...handle, state: "submitted", userOperationHash };
          updatePendingTransfer(handle);
          assertActive();
        }

        return await confirmPendingTransfer(handle, assertActive);
      } catch (error) {
        const normalized = transferError(error);
        if (!dispatched) {
          updatePendingTransfer(null);
          throw normalized;
        }
        if (handle && !handle.transactionHash && !handle.userOperationHash) {
          updatePendingTransfer({ ...handle, state: "unknown" });
          throw new TransferExecutionError("submission-unknown", normalized);
        }
        if (normalized.reason === "failed") {
          updatePendingTransfer(null);
          throw normalized;
        }
        throw normalized;
      } finally {
        if (transferSequence.current === sequence) {
          transferInProgress.current = false;
        }
      }
    },
    [
      confirmPendingTransfer,
      fetchPortfolio,
      ownerKey,
      sdkGetUserOperation,
      sdkSendUserOperation,
      session,
      status,
      updatePendingTransfer,
    ],
  );

  const checkPendingTransfer = useCallback(async (): Promise<ConfirmedTransfer> => {
    const handle = pendingTransferRef.current;
    if (
      transferInProgress.current ||
      !handle ||
      !session?.smartAccount ||
      !ownerKey ||
      status !== "verified"
    ) {
      throw new TransferExecutionError("unavailable");
    }
    const boundary = transferBoundaryKey(ownerKey, session);
    if (!boundary || currentTransferBoundary.current !== boundary) {
      throw new TransferExecutionError("stale-session");
    }
    const sequence = transferSequence.current;
    const assertActive = () => {
      if (
        transferSequence.current !== sequence ||
        currentTransferBoundary.current !== boundary
      ) {
        throw new TransferExecutionError("stale-session");
      }
    };
    transferInProgress.current = true;
    try {
      return await confirmPendingTransfer(handle, assertActive);
    } finally {
      if (transferSequence.current === sequence) {
        transferInProgress.current = false;
      }
    }
  }, [confirmPendingTransfer, ownerKey, session, status]);

  const startNewTransfer = useCallback(() => {
    if (!transferInProgress.current) {
      updatePendingTransfer(null);
    }
  }, [updatePendingTransfer]);


  return {
    fetchOperations,
    prepareMoneyAction,
    checkMoneyAction,
    executeMoneyAction,
    pendingTransfer,
    sendTransfer,
    checkPendingTransfer,
    startNewTransfer,
    reset,
  };
}

export type MoneyActionExecution = ReturnType<typeof useMoneyActionExecution>;
